export * from "./envelope";
export * from "./ingest";
export * from "./decision";
export * from "./memo";
export * from "./simulation";

// ponytail: packages/shared grows further real modules (zod schemas, casing
// map) beyond T8's ingest lib; this just proves the workspace wiring works
// end to end.
export const SHARED_PACKAGE_NAME = "@pdi/shared";
