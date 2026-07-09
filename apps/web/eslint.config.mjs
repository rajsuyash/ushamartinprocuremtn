import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next 16 ships native flat configs — no FlatCompat bridge needed.
const eslintConfig = [...nextCoreWebVitals, ...nextTypescript];

export default eslintConfig;
