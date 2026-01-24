/**
 * CDP Script Executor
 * Provides a generic wrapper for executing browser-side scripts via CDP.
 */

/**
 * Execute a CDP script across all available execution contexts.
 * @param {Object} cdp - CDP connection with call() method and contexts array
 * @param {string} scriptFn - Serialized function string to execute
 * @param {Object} params - Parameters to pass to the script
 * @param {Object} options - Execution options
 * @returns {Promise<any>} Script result
 */
export async function executeInContexts(
  cdp,
  scriptFn,
  params = {},
  options = {},
) {
  const {
    awaitPromise = true,
    returnByValue = true,
    tryMainFrameFirst = false,
  } = options;

  // Wrap the script with params injection
  const paramsJson = JSON.stringify(params);
  const wrappedScript = `(${scriptFn})(${paramsJson})`;

  // Optionally try main frame first (no contextId)
  if (tryMainFrameFirst) {
    try {
      const res = await cdp.call("Runtime.evaluate", {
        expression: wrappedScript,
        returnByValue,
        awaitPromise,
      });
      if (res.result?.value) {
        // Check if it's a success or has meaningful data
        if (res.result.value.success || !res.result.value.error) {
          return res.result.value;
        }
      }
    } catch (e) {
      // Continue to try contexts
    }
  }

  // Try each execution context
  let lastError = null;
  for (const ctx of cdp.contexts) {
    try {
      const res = await cdp.call("Runtime.evaluate", {
        expression: wrappedScript,
        returnByValue,
        awaitPromise,
        contextId: ctx.id,
      });
      if (res.result?.value) {
        const val = res.result.value;
        // Only return if it's a success result, otherwise continue trying other contexts
        if (
          val.success ||
          val.html ||
          (!val.error && Object.keys(val).length > 0)
        ) {
          return val;
        }
        // Store error result in case all contexts fail
        lastError = val;
      }
    } catch (e) {
      // Continue to next context
    }
  }

  // Return the last error we got, or a generic failure message
  return lastError || { error: "Script failed in all contexts" };
}

/**
 * Execute a script that needs click -> wait -> capture pattern
 * Used for operations like opening artifacts or conversation lists
 */
export async function executeWithRetry(
  cdp,
  scriptFn,
  params = {},
  options = {},
) {
  const {
    maxAttempts = 3,
    delayMs = 500,
    awaitPromise = true,
    returnByValue = true,
  } = options;

  const paramsJson = JSON.stringify(params);
  const wrappedScript = `(${scriptFn})(${paramsJson})`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    for (const ctx of cdp.contexts) {
      try {
        const res = await cdp.call("Runtime.evaluate", {
          expression: wrappedScript,
          returnByValue,
          awaitPromise,
          contextId: ctx.id,
        });
        if (res.result?.value?.success) {
          return res.result.value;
        }
      } catch (e) {
        // Continue
      }
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { error: "Script failed after retries" };
}
