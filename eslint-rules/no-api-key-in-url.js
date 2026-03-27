/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow API key patterns in URL strings' },
    messages: {
      apiKeyInUrl:
        'API key pattern "{{match}}" found in string -- pass keys via headers instead',
    },
  },
  create(context) {
    const PATTERN = /[?&](api[-_]?key)=/i;

    function checkLiteral(node, value) {
      const match = PATTERN.exec(value);
      if (match) {
        context.report({
          node,
          messageId: 'apiKeyInUrl',
          data: { match: match[0] },
        });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') {
          checkLiteral(node, node.value);
        }
      },
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          checkLiteral(node, quasi.value.raw);
        }
      },
    };
  },
};
