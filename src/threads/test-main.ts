import { createTest, startThreads, stopThreads } from "./test.ts";
import { p, beta } from "../concrete/pasta.params.ts";
const params = { p, beta, w: 29 };

let Test = await createTest(100, params);

await Test.log("hey");

await startThreads(5, 99, Test);
await Test.log("next");
await stopThreads();

await Test.log("alone");

await startThreads(4, 98, Test);
await Test.log("four times");
await stopThreads();
