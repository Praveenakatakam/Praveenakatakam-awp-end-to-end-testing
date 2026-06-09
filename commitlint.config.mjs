export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-empty': [2, 'never'],
    'jira-ticket-format': [2, 'always'],
  },
  plugins: [
    {
      rules: {
        'jira-ticket-format': (parsed) => {
          const ticket = parsed.scope;
          if (ticket?.match(/^(?:release|[A-Z]{2,4}-\d+)(?:\s*[A-Z]{2,4}-\d+)*/)) {
            return [true];
          }
          return [false, `Invalid scope. Must include an IC- jira ticket.`];
        },
      },
    },
  ],
};
