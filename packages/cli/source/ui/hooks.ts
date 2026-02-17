import { useEffect } from "react";
import { useApp } from "ink";

/**
 * Exits the Ink app once the component has settled into a terminal state.
 * Call with a boolean that flips to true when the command is done.
 */
export function useExit({ done, code = 0 }: { done: boolean; code?: number }): void {
  const { exit } = useApp();

  useEffect(() => {
    if (done) {
      exit();
      setTimeout(() => process.exit(code), 100);
    }
  }, [done, exit, code]);
}
