declare module "zod" {
    type EnumValues = readonly [string, ...string[]];

    export type Infer<TSchema> = TSchema extends ZodSchema<infer TValue> ? TValue : unknown;

    export interface ZodSchema<TValue = unknown> {
        describe(description: string): this;
        optional(): ZodSchema<TValue | undefined>;
        default(value: TValue): ZodSchema<NonNullable<TValue>>;
        int(): this;
        min(value: number): this;
        max(value: number): this;
    }

    type ObjectShape = Record<string, ZodSchema<unknown>>;

    type ObjectValue<TShape extends ObjectShape> = {
        [TKey in keyof TShape]: Infer<TShape[TKey]>;
    };

    export interface ZodBuilder {
        string(): ZodSchema<string>;
        number(): ZodSchema<number>;
        boolean(): ZodSchema<boolean>;
        enum<const TValues extends EnumValues>(values: TValues): ZodSchema<TValues[number]>;
        array<TSchema extends ZodSchema<unknown>>(schema: TSchema): ZodSchema<Infer<TSchema>[]>;
        object<TShape extends ObjectShape>(shape: TShape): ZodSchema<ObjectValue<TShape>>;
        union<const TSchemas extends readonly ZodSchema<unknown>[]>(schemas: TSchemas): ZodSchema<Infer<TSchemas[number]>>;
    }

    export const z: ZodBuilder;
}
