/**
 * Click element in IDE (remote click)
 * This script runs in the browser context via CDP
 */

export const clickElementScript = async function (params) {
  const { selector, index, textContent } = params;

  try {
    let elements = Array.from(document.querySelectorAll(selector));

    if (textContent) {
      elements = elements.filter((el) => el.textContent.includes(textContent));
    }

    const target = elements[index];

    if (target) {
      target.click();
      return { success: true };
    }

    return { error: `Element not found at index ${index}` };
  } catch (e) {
    return { error: e.toString() };
  }
};
