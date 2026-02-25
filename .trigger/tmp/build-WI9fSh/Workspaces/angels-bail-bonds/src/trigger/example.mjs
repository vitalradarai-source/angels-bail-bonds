import {
  task
} from "../../../../chunk-BDBG766A.mjs";
import "../../../../chunk-WZGQJWAS.mjs";
import {
  __name,
  init_esm
} from "../../../../chunk-FUV6SSYK.mjs";

// src/trigger/example.ts
init_esm();
var helloWorldTask = task({
  id: "hello-world",
  run: /* @__PURE__ */ __name(async (payload) => {
    console.log(`Running task with message: ${payload.message}`);
    return { message: `Hello, ${payload.message}!` };
  }, "run")
});
export {
  helloWorldTask
};
//# sourceMappingURL=example.mjs.map
