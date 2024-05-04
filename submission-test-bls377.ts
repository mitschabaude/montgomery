import { compute_msm } from "./submission-bls377.js";
import { curveParams } from "./src/concrete/bls12-377.params.js";
// sanity check that the submission code can run and handles a basic test case

let point = {
  x: 22751760760637705504878160027698824622458942230958800913144762406971228535105703540544554687017331773376179053030n,
  y: 174367514924512705429412616729947089042967561223700141222775688493826177468340587429479085947720121028088838723358n,
  isZero: false,
};

let scalars = [2n, curveParams.order - 1n];

// 2*P + (-1)*P should give P again
let result = await compute_msm([point, point], scalars);

// check result
if (result.x !== point.x || result.y !== point.y) {
  throw Error("failed");
}
console.log("ok");
