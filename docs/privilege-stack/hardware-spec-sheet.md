# Local model capacity checklist

The connector and the model runtime have separate resource needs. Select a model supported by your runtime, then measure its behavior on your workload.

## Record the test configuration

| Item | What to record |
| --- | --- |
| Model | Exact identifier, version, quantization, and download size |
| Runtime and client | Versions, inference settings, and MCP configuration |
| Hardware | CPU, RAM, GPU/accelerator, and available device memory |
| Context | Input size, configured context limit, and expected output size |
| Concurrency | Number of simultaneous requests |
| Connector | Git commit, Clio region, and enabled tools |

## Measure a representative session

Use fictional records and repeat a small set of tasks: find a contact, list matters, retrieve a note, and summarize the returned data. Start with reads. Test writes separately and verify the resulting records in Clio.

Record peak system and device memory, time to first response, total completion time, tool-call accuracy, and errors. Increase context length or concurrent requests to match your intended use. Check for memory exhaustion, disk swapping, timeouts, and incorrect tool arguments.

Model files are only part of the memory requirement. Runtime overhead and conversation context also consume memory. Leave room for the operating system, client, connector, and other applications. Consult the selected model and runtime documentation for their requirements.

## Storage and networking

Allow storage for model files, software, downloads during upgrades, and local logs. Measure log growth and configure retention for your environment rather than assuming a fixed annual volume.

The connector needs access to your Clio region and its OAuth endpoints. Local authentication uses a loopback callback. Review the client and runtime's additional network activity separately. Protect any inference endpoint exposed beyond your own machine with appropriate authentication and network controls.

## Evaluate the results

Check whether the configuration completes your tasks accurately within your acceptable response time and resource limits. Adjust model size, context, concurrency, or hardware as needed and repeat the same tasks. Record the tradeoffs so another user can reproduce the result.

Return to the [local model setup](README.md) or the [connector installation guide](../local-deployment.md).
