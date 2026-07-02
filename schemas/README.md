# Starlight Protocol JSON Schemas

Formal JSON Schema definitions for all Starlight Protocol v1.0.0 methods.

`starlight.protocol.schema.json` is the canonical runtime contract. The
per-method files are retained for focused documentation and code generation;
runtime validation and conformance tests must use the canonical schema.

## Purpose

These schemas enable:
- **Validation**: Programmatic message validation in any language
- **Documentation**: Machine-readable API documentation
- **Code Generation**: Auto-generate types for TypeScript, Go, Rust, etc.
- **Testing**: Validate conformance in the Technology Compatibility Kit (TCK)

## Usage

### JavaScript/Node.js
```javascript
const Ajv = require('ajv');
const registrationSchema = require('./starlight.registration.schema.json');

const ajv = new Ajv();
const validate = ajv.compile(registrationSchema);

const message = {
  jsonrpc: '2.0',
  method: 'starlight.registration',
  params: { layer: 'MySentinel', priority: 5 },
  id: '1'
};

if (validate(message)) {
  console.log('Valid Starlight message');
} else {
  console.log('Invalid:', validate.errors);
}
```

### Python
```python
import json
from jsonschema import validate

with open('starlight.registration.schema.json') as f:
    schema = json.load(f)

message = {
    'jsonrpc': '2.0',
    'method': 'starlight.registration',
    'params': {'layer': 'MySentinel', 'priority': 5},
    'id': '1'
}

validate(instance=message, schema=schema)  # Raises ValidationError if invalid
```

## Schema Files

| Schema | Description |
|--------|-------------|
| `starlight.registration.schema.json` | Client registration to Hub |
| `starlight.intent.schema.json` | Command from Intent layer |
| `starlight.pre_check.schema.json` | Pre-execution handshake |
| `starlight.clear.schema.json` | Sentinel all-clear signal |
| `starlight.wait.schema.json` | Stability veto |
| `starlight.hijack.schema.json` | Sentinel takeover request |
| `starlight.resume.schema.json` | Return control to Hub |
| `starlight.pulse.schema.json` | Heartbeat/entropy broadcast |
| `starlight.action.schema.json` | Sentinel action during hijack |
| `starlight.finish.schema.json` | Mission termination |
| `starlight.context.schema.json` | Shared state update |
| `starlight.checkpoint.schema.json` | Logical milestone |

## Specification

See the full protocol specification at:
- [Starlight Protocol Specification v1.0.0](../spec/STARLIGHT_PROTOCOL_SPEC_v1.0.0.md)

## License

MIT - See [LICENSE](../LICENSE)
