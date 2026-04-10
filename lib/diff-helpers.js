// @ts-check

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeTextForComparison(value) {
  return value.replace(/\r\n/g, '\n');
}

/**
 * @param {string} beforeText
 * @param {string} afterText
 * @returns {boolean}
 */
function textsMatchIgnoringLineEndings(beforeText, afterText) {
  return beforeText === afterText
    || normalizeTextForComparison(beforeText) === normalizeTextForComparison(afterText);
}

module.exports = {
  normalizeTextForComparison,
  textsMatchIgnoringLineEndings,
};
