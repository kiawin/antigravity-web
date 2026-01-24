/**
 * Remote scroll - sync phone scroll to desktop
 * This script runs in the browser context via CDP
 */

export const remoteScrollScript = async function (params) {
  const { scrollTop, scrollPercent } = params;

  try {
    // Find the main scrollable chat container
    const scrollables = [
      ...document.querySelectorAll(
        '#cascade [class*="scroll"], #cascade [style*="overflow"]',
      ),
    ].filter((el) => el.scrollHeight > el.clientHeight);

    const chatArea = document.querySelector(
      "#cascade .overflow-y-auto, #cascade [data-scroll-area]",
    );
    if (chatArea) scrollables.unshift(chatArea);

    if (scrollables.length === 0) {
      const cascade = document.querySelector("#cascade");
      if (cascade && cascade.scrollHeight > cascade.clientHeight) {
        scrollables.push(cascade);
      }
    }

    if (scrollables.length === 0)
      return { error: "No scrollable element found" };

    const target = scrollables[0];

    // Use percentage-based scrolling for better sync
    if (scrollPercent !== undefined) {
      const maxScroll = target.scrollHeight - target.clientHeight;
      target.scrollTop = maxScroll * scrollPercent;
    } else {
      target.scrollTop = scrollTop || 0;
    }

    return { success: true, scrolled: target.scrollTop };
  } catch (e) {
    return { error: e.toString() };
  }
};
