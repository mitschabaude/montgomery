import { vec, withByteLength } from "./immediate.js";

export { WithContext, BinableWithContext };

type WithContext<Context, T> = (ctx: Context) => T;
function WithContext<C>() {
  return {
    return<A>(a: A): WithContext<C, A> {
      return () => a;
    },
    bind<A, B>(
      w: WithContext<C, A>,
      f: (a: A) => WithContext<C, B>
    ): WithContext<C, B> {
      return (c) => f(w(c))(c);
    },
    map<A, B>(w: WithContext<C, A>, f: (a: A) => B): WithContext<C, B> {
      return (c) => f(w(c));
    },
    returnMap<A, B>(
      f: (a: A) => B
    ): (w: WithContext<C, A>) => WithContext<C, B> {
      return (w) => (c) => f(w(c));
    },
  };
}

function BinableWithContext<C>() {
  let W = WithContext<C>();
  return {
    return: W.return,
    vec: W.returnMap(vec),
    withByteLength: W.returnMap(withByteLength),
  };
}
