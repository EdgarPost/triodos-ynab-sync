// @flow

module.exports = {
	parser: 'babel-eslint',
	extends: ['eslint:recommended', 'plugin:flowtype/recommended', 'prettier'],
	plugins: ['prettier'],
	env: {
		node: true,
		jest: true,
		es6: true,
		browser: true,
	},
	rules: {
		'arrow-parens': ['error', 'as-needed'],
	},
};
