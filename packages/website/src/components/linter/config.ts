import type { ParseSettings } from '@typescript-eslint/typescript-estree/use-at-your-own-risk';
import type { ClassicConfig } from '@typescript-eslint/utils/ts-eslint';

export const PARSER_NAME = '@typescript-eslint/parser';

export const defaultParseSettings: ParseSettings = {
  allowInvalidAST: false,
  code: '',
  codeFullText: '',
  comment: true,
  comments: [],
  debugLevel: new Set(),
  DEPRECATED__createDefaultProgram: false,
  errorOnTypeScriptSyntacticAndSemanticIssues: false,
  errorOnUnknownASTType: false,
  EXPERIMENTAL_projectService: undefined,
  EXPERIMENTAL_useSourceOfProjectReferenceRedirect: false,
  extraFileExtensions: [],
  filePath: '',
  jsx: true,
  loc: true,
  log: console.log,
  preserveNodeMaps: true,
  programs: null,
  projects: [],
  range: true,
  singleRun: false,
  suppressDeprecatedPropertyWarnings: false,
  tokens: [],
  tsconfigMatchCache: new Map(),
  tsconfigRootDir: '/',
};

export const defaultEslintConfig: ClassicConfig.Config = {
  parser: PARSER_NAME,
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
      globalReturn: false,
    },
    ecmaVersion: 'latest',
    project: ['./tsconfig.json'],
    sourceType: 'module',
  },
  rules: {},
};
