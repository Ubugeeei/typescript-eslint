import type { TSESTree } from '@typescript-eslint/utils';
import { AST_NODE_TYPES } from '@typescript-eslint/utils';
import { getSourceCode } from '@typescript-eslint/utils/eslint-utils';

import { createRule, getNameFromMember, MemberNameType } from '../util';

type RuleNode =
  | TSESTree.BlockStatement
  | TSESTree.ClassBody
  | TSESTree.Program
  | TSESTree.TSInterfaceBody
  | TSESTree.TSModuleBlock
  | TSESTree.TSTypeLiteral;
type Member =
  | TSESTree.ClassElement
  | TSESTree.ProgramStatement
  | TSESTree.TypeElement;

export default createRule({
  name: 'adjacent-overload-signatures',
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require that function overload signatures be consecutive',
      recommended: 'stylistic',
    },
    schema: [],
    messages: {
      adjacentSignature: 'All {{name}} signatures should be adjacent.',
    },
  },
  defaultOptions: [],
  create(context) {
    const sourceCode = getSourceCode(context);

    interface Method {
      name: string;
      static: boolean;
      callSignature: boolean;
      type: MemberNameType;
    }

    /**
     * Gets the name and attribute of the member being processed.
     * @param member the member being processed.
     * @returns the name and attribute of the member or null if it's a member not relevant to the rule.
     */
    function getMemberMethod(member: TSESTree.Node): Method | null {
      const isStatic = 'static' in member && !!member.static;

      switch (member.type) {
        case AST_NODE_TYPES.ExportDefaultDeclaration:
        case AST_NODE_TYPES.ExportNamedDeclaration: {
          // export statements (e.g. export { a };)
          // have no declarations, so ignore them
          if (!member.declaration) {
            return null;
          }

          return getMemberMethod(member.declaration);
        }
        case AST_NODE_TYPES.TSDeclareFunction:
        case AST_NODE_TYPES.FunctionDeclaration: {
          const name = member.id?.name ?? null;
          if (name == null) {
            return null;
          }
          return {
            name,
            static: isStatic,
            callSignature: false,
            type: MemberNameType.Normal,
          };
        }
        case AST_NODE_TYPES.TSMethodSignature:
          return {
            ...getNameFromMember(member, sourceCode),
            static: isStatic,
            callSignature: false,
          };
        case AST_NODE_TYPES.TSCallSignatureDeclaration:
          return {
            name: 'call',
            static: isStatic,
            callSignature: true,
            type: MemberNameType.Normal,
          };
        case AST_NODE_TYPES.TSConstructSignatureDeclaration:
          return {
            name: 'new',
            static: isStatic,
            callSignature: false,
            type: MemberNameType.Normal,
          };
        case AST_NODE_TYPES.MethodDefinition:
          return {
            ...getNameFromMember(member, sourceCode),
            static: isStatic,
            callSignature: false,
          };
      }

      return null;
    }

    function isSameMethod(method1: Method, method2: Method | null): boolean {
      return (
        !!method2 &&
        method1.name === method2.name &&
        method1.static === method2.static &&
        method1.callSignature === method2.callSignature &&
        method1.type === method2.type
      );
    }

    function getMembers(node: RuleNode): Member[] {
      switch (node.type) {
        case AST_NODE_TYPES.ClassBody:
        case AST_NODE_TYPES.Program:
        case AST_NODE_TYPES.TSModuleBlock:
        case AST_NODE_TYPES.TSInterfaceBody:
        case AST_NODE_TYPES.BlockStatement:
          return node.body;

        case AST_NODE_TYPES.TSTypeLiteral:
          return node.members;
      }
    }

    /**
     * Check the body for overload methods.
     * @param {ASTNode} node the body to be inspected.
     */
    function checkBodyForOverloadMethods(node: RuleNode): void {
      const members = getMembers(node);

      let lastMethod: Method | null = null;
      const seenMethods: Method[] = [];

      members.forEach(member => {
        const method = getMemberMethod(member);
        if (method == null) {
          lastMethod = null;
          return;
        }

        const index = seenMethods.findIndex(seenMethod =>
          isSameMethod(method, seenMethod),
        );
        if (index > -1 && !isSameMethod(method, lastMethod)) {
          context.report({
            node: member,
            messageId: 'adjacentSignature',
            data: {
              name: `${method.static ? 'static ' : ''}${method.name}`,
            },
          });
        } else if (index === -1) {
          seenMethods.push(method);
        }

        lastMethod = method;
      });
    }

    return {
      ClassBody: checkBodyForOverloadMethods,
      Program: checkBodyForOverloadMethods,
      TSModuleBlock: checkBodyForOverloadMethods,
      TSTypeLiteral: checkBodyForOverloadMethods,
      TSInterfaceBody: checkBodyForOverloadMethods,
      BlockStatement: checkBodyForOverloadMethods,
    };
  },
});
