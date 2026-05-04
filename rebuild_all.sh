#!/bin/bash
set -e

BASE_DIR="/home/tanner/Projects/Zenith-MCP"
GRAMMARS_DIR="$BASE_DIR/grammars"
BUILD_DIR="$BASE_DIR/build_grammars"

# -----------------------------------------
# PRE-FLIGHT CHECKS
# -----------------------------------------

# Check for tree-sitter CLI
if ! command -v tree-sitter &> /dev/null; then
    echo "❌ ERROR: 'tree-sitter' CLI not found."
    echo "Please run: npm install -g tree-sitter-cli@latest"
    exit 1
fi

TS_VERSION=$(tree-sitter --version | grep -oP '\d+\.\d+')
if [[ $(echo "$TS_VERSION >= 0.22" | bc -l) -ne 1 ]]; then
    echo "❌ ERROR: tree-sitter CLI version must be >= 0.22.0 for ABI 15."
    echo "Current version: $(tree-sitter --version)"
    echo "Please run: npm install -g tree-sitter-cli@latest"
    exit 1
fi

# Check for Emscripten (CRITICAL: Required to compile C to WASM)
if ! command -v emcc &> /dev/null; then
    echo "❌ ERROR: 'emcc' (Emscripten) not found in PATH."
    echo "Building from source REQUIRES Emscripten to compile to WebAssembly."
    echo "Install it via: https://emscripten.org/docs/getting_started/downloads.html"
    echo "Quick install (if you have git & python):"
    echo "  git clone https://github.com/emscripten-core/emsdk.git"
    echo "  cd emsdk"
    echo "  ./emsdk install latest"
    echo "  ./emsdk activate latest"
    echo "  source ./emsdk_env.sh"
    exit 1
fi

echo "✅ Pre-flight checks passed."
echo "   - Tree-sitter: $(tree-sitter --version)"
echo "   - Emscripten: $(emcc --version | head -n 1)"
echo "-----------------------------------------"

# -----------------------------------------
# GRAMMAR DEFINITIONS
# Format: "OutputName|GitHubRepoURL|SubDirectory(optional)"
# -----------------------------------------

GRAMMARS=(
    # --- Your Incompatible List ---
    "bash|tree-sitter/tree-sitter-bash|"
    "c_sharp|tree-sitter/tree-sitter-c-sharp|"
    "cpp|tree-sitter/tree-sitter-cpp|"
    "css|tree-sitter/tree-sitter-css|"
    "java|tree-sitter/tree-sitter-java|"
    "javascript|tree-sitter/tree-sitter-javascript|"
    "json|tree-sitter/tree-sitter-json|"
    "kotlin|fwcd/tree-sitter-kotlin|"
    "python|tree-sitter/tree-sitter-python|"
    "ruby|tree-sitter/tree-sitter-ruby|"
    "sql|mattn/tree-sitter-sql|"
    "swift|alex-pinkus/tree-sitter-swift|"
    "yaml|ikatyang/tree-sitter-yaml|"
    
    # --- Special Cases (Require Sub-directories) ---
    "markdown|MDeiml/tree-sitter-markdown|tree-sitter-markdown"
    "tsx|tree-sitter/tree-sitter-typescript|tsx"
    "typescript|tree-sitter/tree-sitter-typescript|typescript"
    
    # --- Bonus Languages You Didn't Have ---
    "html|tree-sitter/tree-sitter-html|"
    "xml|Observatory-UI/tree-sitter-xml|"
    "toml|ikatyang/tree-sitter-toml|"
    "dockerfile|camdencheek/tree-sitter-dockerfile|"
    "lua|tree-sitter/tree-sitter-lua|"
    "zig|maxxnino/tree-sitter-zig|"
)

# -----------------------------------------
# BUILD LOOP
# -----------------------------------------

mkdir -p "$GRAMMARS_DIR" "$BUILD_DIR"

for item in "${GRAMMARS[@]}"; do
    IFS="|" read -r name repo subdir <<< "$item"
    
    echo ""
    echo "========================================="
    echo "Processing: tree-sitter-${name}"
    echo "========================================="
    
    target_dir="$BUILD_DIR/$name"
    
    # Clone or pull
    if [ -d "$target_dir" ]; then
        echo "[1/3] Pulling latest changes..."
        git -C "$target_dir" pull 
    else
        echo "[1/3] Cloning repository..."
        git clone --depth 1 "https://github.com/${repo}.git" "$target_dir" 
    fi
    
    # Navigate to the correct subdirectory if required
    build_path="$target_dir/${subdir}"
    if [ ! -d "$build_path" ]; then
        echo "❌ ERROR: Directory $build_path does not exist!"
        continue
    fi
    
    cd "$build_path"
    
    # Generate C code from grammar.js (Safe to run even if already generated)
    echo "[2/3] Generating parser C code..."
    tree-sitter generate 2>/dev/null || true
    
    # Build to WASM (Outputs as 'tree-sitter.wasm' in current dir)
    echo "[3/3] Compiling to WebAssembly (ABI 15)..."
    if tree-sitter build -w ; then
        if [ -f "tree-sitter.wasm" ]; then
            mv "tree-sitter.wasm" "$GRAMMARS_DIR/tree-sitter-${name}.wasm"
            echo "✅ SUCCESS -> $GRAMMARS_DIR/tree-sitter-${name}.wasm"
        else
            echo "❌ FAILED: tree-sitter build completed, but .wasm file not found."
        fi
    else
        echo "❌ FAILED: tree-sitter build -w exited with an error."
    fi
done

echo ""
echo "========================================="
echo "Build process complete!"
echo "You can now run: node check_abis.mjs"
echo "Note: You can safely delete $BUILD_DIR if everything passed."
echo "========================================="
