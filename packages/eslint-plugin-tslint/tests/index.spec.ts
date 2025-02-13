import * as parser from '@typescript-eslint/parser';
import { TSESLint } from '@typescript-eslint/utils';
import { readFileSync } from 'fs';
import path = require('path');

import type { ClassicConfig } from '@typescript-eslint/utils/ts-eslint';

import type { Options } from '../src/rules/config';
import rule from '../src/rules/config';

const ruleTester = new TSESLint.RuleTester({
  parserOptions: {
    ecmaVersion: 6,
    sourceType: 'module',
    ecmaFeatures: {},
    /**
     * Project is needed to generate the parserServices
     * within @typescript-eslint/parser
     */
    project: './tests/fixtures/fixture-project/tsconfig.json',
    warnOnUnsupportedTypeScriptVersion: false,
  },
  parser: require.resolve('@typescript-eslint/parser'),
});

/**
 * Inline rules should be supported
 */
const tslintRulesConfig: Options = [
  {
    rules: {
      semicolon: [true, 'always'],
    },
  },
];

/**
 * Custom rules directories should be supported
 */
const tslintRulesDirectoryConfig: Options = [
  {
    rulesDirectory: ['./tests/fixtures/test-tslint-rules-directory'],
    rules: {
      'always-fail': {
        severity: 'error',
      },
    },
  },
];

const TEST_PROJECT_PATH = path.resolve(
  __dirname,
  'fixtures',
  'test-project',
  'tsconfig.json',
);

ruleTester.run('tslint/config', rule, {
  valid: [
    {
      code: 'var foo = true;',
      options: tslintRulesConfig,
      filename: './tests/fixtures/fixture-project/1.ts',
    },
    {
      filename: './tests/fixtures/test-project/file-spec.ts',
      code: readFileSync(
        './tests/fixtures/test-project/file-spec.ts',
        'utf8',
      ).replace(/\n/g, ' '),
      parserOptions: {
        project: TEST_PROJECT_PATH,
      },
      options: tslintRulesConfig,
    },
    {
      code: 'throw "should be ok because rule is not loaded";',
      options: tslintRulesConfig,
      filename: './tests/fixtures/fixture-project/2.ts',
    },
  ],

  invalid: [
    {
      options: [{ lintFile: './tests/fixtures/test-project/tslint.json' }],
      code: 'throw "err" // no-string-throw',
      output: 'throw new Error("err") // no-string-throw',
      filename: './tests/fixtures/fixture-project/3.ts',
      errors: [
        {
          messageId: 'failure',
          data: {
            message:
              'Throwing plain strings (not instances of Error) gives no stack traces',
            ruleName: 'no-string-throw',
          },
        },
      ],
    },
    {
      code: 'var foo = true // semicolon',
      options: tslintRulesConfig,
      output: 'var foo = true; // semicolon',
      filename: './tests/fixtures/fixture-project/4.ts',
      errors: [
        {
          messageId: 'failure',
          data: {
            message: 'Missing semicolon',
            ruleName: 'semicolon',
          },
          line: 1,
          column: 15,
        },
      ],
    },
    {
      code: 'var foo = true // fail',
      options: tslintRulesDirectoryConfig,
      output: null,
      filename: './tests/fixtures/fixture-project/5.ts',
      errors: [
        {
          messageId: 'failure',
          data: {
            message: 'failure',
            ruleName: 'always-fail',
          },
          line: 1,
          column: 1,
        },
      ],
    },
    {
      filename: './tests/fixtures/test-project/source.ts',
      code: readFileSync(
        './tests/fixtures/test-project/source.ts',
        'utf8',
      ).replace(/\n/g, ' '),
      parserOptions: {
        project: TEST_PROJECT_PATH,
      },
      options: [
        {
          rulesDirectory: [
            path.join(
              path.dirname(require.resolve('tslint/package.json')),
              'lib',
              'rules',
            ),
          ],
          rules: { 'restrict-plus-operands': true },
        },
      ],
      errors: [
        {
          messageId: 'failure',
          data: {
            message:
              'Operands of \'+\' operation must either be both strings or both numbers or both bigints, but found 1 + "2". Consider using template literals.',
            ruleName: 'restrict-plus-operands',
          },
        },
      ],
    },
  ],
});

describe('tslint/error', () => {
  function testOutput(code: string, config: ClassicConfig.Config): void {
    const linter = new TSESLint.Linter();
    linter.defineRule('tslint/config', rule);
    linter.defineParser('@typescript-eslint/parser', parser);

    expect(() => linter.verify(code, config)).toThrow(
      'You have used a rule which requires parserServices to be generated. You must therefore provide a value for the "parserOptions.project" property for @typescript-eslint/parser.',
    );
  }

  it('should error on missing project', () => {
    testOutput('foo;', {
      rules: {
        'tslint/config': [2, tslintRulesConfig],
      },
      parser: '@typescript-eslint/parser',
    });
  });

  it('should error on default parser', () => {
    testOutput('foo;', {
      parserOptions: {
        project: TEST_PROJECT_PATH,
      },
      rules: {
        'tslint/config': [2, tslintRulesConfig],
      },
    });
  });

  it('should not crash if there are no tslint rules specified', () => {
    const linter = new TSESLint.Linter();
    jest.spyOn(console, 'warn').mockImplementation();
    linter.defineRule('tslint/config', rule);
    linter.defineParser('@typescript-eslint/parser', parser);

    const filePath = path.resolve(
      __dirname,
      'fixtures',
      'test-project',
      'extra.ts',
    );

    expect(() =>
      linter.verify(
        'foo;',
        {
          parserOptions: {
            project: TEST_PROJECT_PATH,
          },
          rules: {
            'tslint/config': [2, {}],
          },
          parser: '@typescript-eslint/parser',
        },
        filePath,
      ),
    ).not.toThrow();

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `Tried to lint ${filePath} but found no valid, enabled rules for this file type and file path in the resolved configuration.`,
      ),
    );
    jest.resetAllMocks();
  });
});
