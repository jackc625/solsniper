/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow template literals with expressions in SQL-adjacent method calls' },
    messages: {
      noTemplateLiteral:
        'Template literal in {{method}}() call -- use parameterized queries with ? or @named placeholders',
    },
  },
  create(context) {
    const SQL_METHODS = new Set(['prepare', 'run', 'exec', 'all', 'get']);

    return {
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          SQL_METHODS.has(node.callee.property.name)
        ) {
          for (const arg of node.arguments) {
            if (arg.type === 'TemplateLiteral' && arg.expressions.length > 0) {
              context.report({
                node: arg,
                messageId: 'noTemplateLiteral',
                data: { method: node.callee.property.name },
              });
            }
          }
        }
      },
    };
  },
};
