import { compute_msm } from "./submission-bls377.js";
import { curveParams } from "./src/concrete/bls12-377.params.js";
import { BLS12377 } from "./src/concrete/bls12-377.js";
// sanity check that the submission code can run and handles a basic test case

let point = {
  x: 111871295567327857271108656266735188604298176728428155068227918632083036401841336689521497731900230387779623820740n,
  y: 76860045326390600098227152997486448974650822224305058012700629806287380625419427989664237630603922765089083164740n,
  isZero: false,
};

let Curve = BLS12377.Bigint.Projective;

let p = Curve.fromAffine(point);
console.log(Curve.isOnCurve(p), Curve.isInSubgroup(p));

let scalars = [2n, curveParams.order - 1n];

// 2*P + (-1)*P should give P again
let result = await compute_msm([point, point], scalars);

// check result
if (result.x !== point.x || result.y !== point.y) {
  throw Error("failed");
}
console.log("2 points ok");

const n = 1 << 20;
let randomScalars = Array.from({ length: n }, () => Curve.Scalar.random());
// let randomPoints = BLS12377.Affine.randomPointsBigint(n);
let samePoints = Array.from({ length: n }, () => point);
let scalarSum = randomScalars.reduce(Curve.Scalar.add);

// random points should work
// await compute_msm(randomPoints, randomScalars);
// console.log("random points ok");

// msm should be the same as scaling by the sum of scalars
let result2 = await compute_msm(samePoints, randomScalars);
let result3 = await compute_msm([point], [scalarSum]);

if (result2.x !== result3.x || result2.y !== result3.y) {
  throw Error("failed");
}
console.log("same points ok");
