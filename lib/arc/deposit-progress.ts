/** Observe the deposit broadcast, without confusing a token approval with a deposit. */
export function observeDepositSubmission<T extends object>(adapter: T, onSubmitted: (txHash: string) => void, actions = /^gateway\.v1\.deposit(?:For|WithPermit|WithAuthorization)?$/): T {
  return new Proxy(adapter, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === "prepareAction" && typeof value === "function") {
        return async (...args: unknown[]) => {
          const request = await Reflect.apply(value, target, args);
          if (!actions.test(String(args[0]))) return request;
          return new Proxy(request, {
            get(prepared, property) {
              const member = Reflect.get(prepared, property, prepared);
              if (property === "execute") return async (...executeArgs: unknown[]) => {
                const hash = await Reflect.apply(member, prepared, executeArgs);
                if (typeof hash === "string") onSubmitted(hash);
                return hash;
              };
              return typeof member === "function" ? member.bind(prepared) : member;
            },
          });
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export const CCTP_BURN_ACTIONS = /^cctp\.v2\.(?:depositForBurn(?:WithHook|WithFees|WithHookAndFees)?|customBurn(?:WithHook)?)$/;
