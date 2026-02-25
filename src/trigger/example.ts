import { task } from "@trigger.dev/sdk/v3";

// Example background task — rename/replace this as your project grows
export const helloWorldTask = task({
  id: "hello-world",
  run: async (payload: { message: string }) => {
    console.log(`Running task with message: ${payload.message}`);
    return { message: `Hello, ${payload.message}!` };
  },
});
