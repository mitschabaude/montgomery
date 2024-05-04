import { compute_msm } from "./submission.js";
import { curveParams } from "./src/concrete/ed-on-bls12-377.params.js";
// sanity check that the submission code can run and handles a basic test case

let point = {
  x: 2796670805570508460920584878396618987767121022598342527208237783066948667246n,
  y: 8134280397689638111748378379571739274369602049665521098046934931245960532166n,
  z: 1n,
  t: 3446088593515175914550487355059397868296219355049460558182099906777968652023n,
};

let scalars = [2n, curveParams.order - 1n];

// 2*P + (-1)*P should give P again
let result = await compute_msm([point, point], scalars);

// check result
if (result.x !== point.x || result.y !== point.y) {
  throw Error("failed");
}
console.log("ok");
