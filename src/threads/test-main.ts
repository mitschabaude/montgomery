import { createTest, startThreads, stopThreads } from "./test.js";
import { p, beta } from "../concrete/pasta.params.js";
const params = { p, beta, w: 29 };

let Test = await createTest(10, params);

await Test.log("hey");

await startThreads(5, Test);
await Test.log("next");
await stopThreads();

await Test.log("alone");

await startThreads(4, Test);
await Test.log("four times");
await stopThreads();
