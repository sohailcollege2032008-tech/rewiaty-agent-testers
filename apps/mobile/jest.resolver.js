const workletsResolver = require('react-native-worklets/jest/resolver');

module.exports = function resolver(request, options) {
  try {
    return workletsResolver(request, options);
  } catch (err) {
    if (request.startsWith('.') && request.endsWith('.js')) {
      return workletsResolver(request.slice(0, -3) + '.ts', options);
    }
    throw err;
  }
};
