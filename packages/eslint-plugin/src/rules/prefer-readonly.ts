import type { TSESTree } from '@typescript-eslint/utils';
import { AST_NODE_TYPES, ASTUtils } from '@typescript-eslint/utils';
import { getSourceCode } from '@typescript-eslint/utils/eslint-utils';
import * as tsutils from 'ts-api-utils';
import * as ts from 'typescript';

import { createRule, getParserServices, typeIsOrHasBaseType } from '../util';

type MessageIds = 'preferReadonly';
type Options = [
  {
    onlyInlineLambdas?: boolean;
  },
];

const functionScopeBoundaries = [
  AST_NODE_TYPES.ArrowFunctionExpression,
  AST_NODE_TYPES.FunctionDeclaration,
  AST_NODE_TYPES.FunctionExpression,
  AST_NODE_TYPES.MethodDefinition,
].join(', ');

export default createRule<Options, MessageIds>({
  name: 'prefer-readonly',
  meta: {
    docs: {
      description:
        "Require private members to be marked as `readonly` if they're never modified outside of the constructor",
      requiresTypeChecking: true,
    },
    fixable: 'code',
    messages: {
      preferReadonly:
        "Member '{{name}}' is never reassigned; mark it as `readonly`.",
    },
    schema: [
      {
        additionalProperties: false,
        properties: {
          onlyInlineLambdas: {
            type: 'boolean',
          },
        },
        type: 'object',
      },
    ],
    type: 'suggestion',
  },
  defaultOptions: [{ onlyInlineLambdas: false }],
  create(context, [{ onlyInlineLambdas }]) {
    const services = getParserServices(context);
    const checker = services.program.getTypeChecker();
    const classScopeStack: ClassScope[] = [];

    function handlePropertyAccessExpression(
      node: ts.PropertyAccessExpression,
      parent: ts.Node,
      classScope: ClassScope,
    ): void {
      if (ts.isBinaryExpression(parent)) {
        handleParentBinaryExpression(node, parent, classScope);
        return;
      }

      if (ts.isDeleteExpression(parent) || isDestructuringAssignment(node)) {
        classScope.addVariableModification(node);
        return;
      }

      if (
        ts.isPostfixUnaryExpression(parent) ||
        ts.isPrefixUnaryExpression(parent)
      ) {
        handleParentPostfixOrPrefixUnaryExpression(parent, classScope);
      }
    }

    function handleParentBinaryExpression(
      node: ts.PropertyAccessExpression,
      parent: ts.BinaryExpression,
      classScope: ClassScope,
    ): void {
      if (
        parent.left === node &&
        tsutils.isAssignmentKind(parent.operatorToken.kind)
      ) {
        classScope.addVariableModification(node);
      }
    }

    function handleParentPostfixOrPrefixUnaryExpression(
      node: ts.PostfixUnaryExpression | ts.PrefixUnaryExpression,
      classScope: ClassScope,
    ): void {
      if (
        node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken
      ) {
        classScope.addVariableModification(
          node.operand as ts.PropertyAccessExpression,
        );
      }
    }

    function isDestructuringAssignment(
      node: ts.PropertyAccessExpression,
    ): boolean {
      let current: ts.Node = node.parent;

      while (current) {
        const parent = current.parent;

        if (
          ts.isObjectLiteralExpression(parent) ||
          ts.isArrayLiteralExpression(parent) ||
          ts.isSpreadAssignment(parent) ||
          (ts.isSpreadElement(parent) &&
            ts.isArrayLiteralExpression(parent.parent))
        ) {
          current = parent;
        } else if (
          ts.isBinaryExpression(parent) &&
          !ts.isPropertyAccessExpression(current)
        ) {
          return (
            parent.left === current &&
            parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
          );
        } else {
          break;
        }
      }

      return false;
    }

    function isFunctionScopeBoundaryInStack(
      node:
        | TSESTree.ArrowFunctionExpression
        | TSESTree.FunctionDeclaration
        | TSESTree.FunctionExpression
        | TSESTree.MethodDefinition,
    ): boolean {
      if (classScopeStack.length === 0) {
        return false;
      }

      const tsNode = services.esTreeNodeToTSNodeMap.get(node);
      if (ts.isConstructorDeclaration(tsNode)) {
        return false;
      }

      return tsutils.isFunctionScopeBoundary(tsNode);
    }

    function getEsNodesFromViolatingNode(
      violatingNode: ParameterOrPropertyDeclaration,
    ): { esNode: TSESTree.Node; nameNode: TSESTree.Node } {
      if (
        ts.isParameterPropertyDeclaration(violatingNode, violatingNode.parent)
      ) {
        return {
          esNode: services.tsNodeToESTreeNodeMap.get(violatingNode.name),
          nameNode: services.tsNodeToESTreeNodeMap.get(violatingNode.name),
        };
      }

      return {
        esNode: services.tsNodeToESTreeNodeMap.get(violatingNode),
        nameNode: services.tsNodeToESTreeNodeMap.get(violatingNode.name),
      };
    }

    return {
      'ClassDeclaration, ClassExpression'(
        node: TSESTree.ClassDeclaration | TSESTree.ClassExpression,
      ): void {
        classScopeStack.push(
          new ClassScope(
            checker,
            services.esTreeNodeToTSNodeMap.get(node),
            onlyInlineLambdas,
          ),
        );
      },
      'ClassDeclaration, ClassExpression:exit'(): void {
        const finalizedClassScope = classScopeStack.pop()!;
        const sourceCode = getSourceCode(context);

        for (const violatingNode of finalizedClassScope.finalizeUnmodifiedPrivateNonReadonlys()) {
          const { esNode, nameNode } =
            getEsNodesFromViolatingNode(violatingNode);
          context.report({
            data: {
              name: sourceCode.getText(nameNode),
            },
            fix: fixer => fixer.insertTextBefore(nameNode, 'readonly '),
            messageId: 'preferReadonly',
            node: esNode,
          });
        }
      },
      MemberExpression(node): void {
        if (classScopeStack.length !== 0 && !node.computed) {
          const tsNode = services.esTreeNodeToTSNodeMap.get(
            node,
          ) as ts.PropertyAccessExpression;
          handlePropertyAccessExpression(
            tsNode,
            tsNode.parent,
            classScopeStack[classScopeStack.length - 1],
          );
        }
      },
      [functionScopeBoundaries](
        node:
          | TSESTree.ArrowFunctionExpression
          | TSESTree.FunctionDeclaration
          | TSESTree.FunctionExpression
          | TSESTree.MethodDefinition,
      ): void {
        if (ASTUtils.isConstructor(node)) {
          classScopeStack[classScopeStack.length - 1].enterConstructor(
            services.esTreeNodeToTSNodeMap.get(node),
          );
        } else if (isFunctionScopeBoundaryInStack(node)) {
          classScopeStack[classScopeStack.length - 1].enterNonConstructor();
        }
      },
      [`${functionScopeBoundaries}:exit`](
        node:
          | TSESTree.ArrowFunctionExpression
          | TSESTree.FunctionDeclaration
          | TSESTree.FunctionExpression
          | TSESTree.MethodDefinition,
      ): void {
        if (ASTUtils.isConstructor(node)) {
          classScopeStack[classScopeStack.length - 1].exitConstructor();
        } else if (isFunctionScopeBoundaryInStack(node)) {
          classScopeStack[classScopeStack.length - 1].exitNonConstructor();
        }
      },
    };
  },
});

type ParameterOrPropertyDeclaration =
  | ts.ParameterDeclaration
  | ts.PropertyDeclaration;

const OUTSIDE_CONSTRUCTOR = -1;
const DIRECTLY_INSIDE_CONSTRUCTOR = 0;

class ClassScope {
  private readonly privateModifiableMembers = new Map<
    string,
    ParameterOrPropertyDeclaration
  >();
  private readonly privateModifiableStatics = new Map<
    string,
    ParameterOrPropertyDeclaration
  >();
  private readonly memberVariableModifications = new Set<string>();
  private readonly staticVariableModifications = new Set<string>();

  private readonly classType: ts.Type;

  private constructorScopeDepth = OUTSIDE_CONSTRUCTOR;

  public constructor(
    private readonly checker: ts.TypeChecker,
    classNode: ts.ClassLikeDeclaration,
    private readonly onlyInlineLambdas?: boolean,
  ) {
    const classType = checker.getTypeAtLocation(classNode);
    if (tsutils.isIntersectionType(classType)) {
      this.classType = classType.types[0];
    } else {
      this.classType = classType;
    }

    for (const member of classNode.members) {
      if (ts.isPropertyDeclaration(member)) {
        this.addDeclaredVariable(member);
      }
    }
  }

  public addDeclaredVariable(node: ParameterOrPropertyDeclaration): void {
    if (
      !(
        tsutils.isModifierFlagSet(node, ts.ModifierFlags.Private) ||
        node.name.kind === ts.SyntaxKind.PrivateIdentifier
      ) ||
      tsutils.isModifierFlagSet(node, ts.ModifierFlags.Readonly) ||
      ts.isComputedPropertyName(node.name)
    ) {
      return;
    }

    if (
      this.onlyInlineLambdas &&
      node.initializer !== undefined &&
      !ts.isArrowFunction(node.initializer)
    ) {
      return;
    }

    (tsutils.isModifierFlagSet(node, ts.ModifierFlags.Static)
      ? this.privateModifiableStatics
      : this.privateModifiableMembers
    ).set(node.name.getText(), node);
  }

  public addVariableModification(node: ts.PropertyAccessExpression): void {
    const modifierType = this.checker.getTypeAtLocation(node.expression);
    if (
      !modifierType.getSymbol() ||
      !typeIsOrHasBaseType(modifierType, this.classType)
    ) {
      return;
    }

    const modifyingStatic =
      tsutils.isObjectType(modifierType) &&
      tsutils.isObjectFlagSet(modifierType, ts.ObjectFlags.Anonymous);
    if (
      !modifyingStatic &&
      this.constructorScopeDepth === DIRECTLY_INSIDE_CONSTRUCTOR
    ) {
      return;
    }

    (modifyingStatic
      ? this.staticVariableModifications
      : this.memberVariableModifications
    ).add(node.name.text);
  }

  public enterConstructor(
    node:
      | ts.ConstructorDeclaration
      | ts.GetAccessorDeclaration
      | ts.MethodDeclaration
      | ts.SetAccessorDeclaration,
  ): void {
    this.constructorScopeDepth = DIRECTLY_INSIDE_CONSTRUCTOR;

    for (const parameter of node.parameters) {
      if (tsutils.isModifierFlagSet(parameter, ts.ModifierFlags.Private)) {
        this.addDeclaredVariable(parameter);
      }
    }
  }

  public exitConstructor(): void {
    this.constructorScopeDepth = OUTSIDE_CONSTRUCTOR;
  }

  public enterNonConstructor(): void {
    if (this.constructorScopeDepth !== OUTSIDE_CONSTRUCTOR) {
      this.constructorScopeDepth += 1;
    }
  }

  public exitNonConstructor(): void {
    if (this.constructorScopeDepth !== OUTSIDE_CONSTRUCTOR) {
      this.constructorScopeDepth -= 1;
    }
  }

  public finalizeUnmodifiedPrivateNonReadonlys(): ParameterOrPropertyDeclaration[] {
    this.memberVariableModifications.forEach(variableName => {
      this.privateModifiableMembers.delete(variableName);
    });

    this.staticVariableModifications.forEach(variableName => {
      this.privateModifiableStatics.delete(variableName);
    });

    return [
      ...Array.from(this.privateModifiableMembers.values()),
      ...Array.from(this.privateModifiableStatics.values()),
    ];
  }
}
