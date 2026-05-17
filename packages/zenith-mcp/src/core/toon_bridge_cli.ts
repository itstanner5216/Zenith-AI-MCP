#!/usr/bin/env node
import fs from 'node:fs';
import { compressToon } from './toon_bridge.js';

async function main(): Promise<void> {
    const [filePath, budgetRaw] = process.argv.slice(2);
    const budget = Number.parseInt(budgetRaw ?? '', 10);

    if (!filePath || !Number.isFinite(budget) || budget <= 0) {
        process.exit(1);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    process.stdout.write(await compressToon(content, budget, filePath));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
