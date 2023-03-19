export { Tuple };

type Tuple<T> = [] | [T, ...T[]];
