export { UnwrapPromise };

type UnwrapPromise<T> = T extends Promise<infer U> ? U : never;
