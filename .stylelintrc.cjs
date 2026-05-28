module.exports = {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['dist/**', 'dist-desktop/**', 'coverage/**', 'node_modules/**'],
  rules: {
    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: ['theme', 'layer', 'apply'],
      },
    ],
  },
};
