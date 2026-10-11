// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Proíbe conversões numéricas onde trafega dinheiro (AGENTS §5.1, falha eliminatória).
 * `Number(...)`, `parseFloat`, `parseInt` e `toFixed` transformam valores exatos em ponto flutuante.
 */
const noFloatMoney = [
  {
    selector: "CallExpression[callee.name='Number']",
    message: "Dinheiro nunca vira number: use Money (bigint em centavos).",
  },
  {
    selector: "CallExpression[callee.name=/^parse(Float|Int)$/]",
    message: "Dinheiro nunca vira number: use Money.from para ler strings decimais.",
  },
  {
    selector: "CallExpression[callee.object.name='Number']",
    message: "Dinheiro nunca vira number: use Money (bigint em centavos).",
  },
  {
    selector: "CallExpression[callee.property.name='toFixed']",
    message: "toFixed opera sobre ponto flutuante: use Money.toString().",
  },
];

/** Bibliotecas de infraestrutura que o domínio e a aplicação não podem conhecer (spec §2.1). */
const infraLibraries = ["@mikro-orm/*", "@aws-sdk/*", "pino", "pino-*", "nestjs-pino", "prom-client"];

export default tseslint.config(
  { ignores: ["node_modules/", "dist/", "coverage/", "test/load/results/"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-extraneous-class": "off",
      eqeqeq: ["error", "always"],
      "no-console": "error",
    },
  },
  {
    files: ["**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["src/**/domain/**/*.ts", "src/**/persistence/**/*mapper*.ts", "src/**/persistence/**/*money*.ts"],
    rules: { "no-restricted-syntax": ["error", ...noFloatMoney] },
  },
  {
    files: ["src/**/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@nestjs/*", ...infraLibraries],
              message: "O domínio não depende de framework nem de infraestrutura (spec §2.1).",
            },
            {
              group: ["**/application/**", "**/infra/**"],
              message: "O domínio não importa application nem infra (spec §2.1).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/application/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [...infraLibraries, "**/infra/**"],
              message: "A aplicação depende de portas, nunca de infraestrutura (spec §2.1).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    // Migrations usam addSql de forma síncrona; a assinatura async é contrato do MikroORM.
    files: ["migrations/**/*.ts"],
    rules: { "@typescript-eslint/require-await": "off" },
  },
);
