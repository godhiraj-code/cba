package io.starlight.protocol;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;

/**
 * JSON-RPC 2.0 message for the Starlight Protocol.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class Message {
    
    private static final ObjectMapper MAPPER = new ObjectMapper();
    
    @JsonProperty("jsonrpc")
    private String jsonrpc = "2.0";
    
    @JsonProperty("method")
    private String method;
    
    @JsonProperty("params")
    private Object params;
    
    @JsonProperty("id")
    private String id;
    
    @JsonProperty("result")
    private Object result;
    
    @JsonProperty("error")
    private RpcError error;
    
    public Message() {}
    
    public Message(String method, Object params) {
        this.method = method;
        this.params = params;
        this.id = String.valueOf(System.nanoTime());
    }
    
    public static Message withId(String id, String method, Object params) {
        Message msg = new Message(method, params);
        msg.id = id;
        return msg;
    }
    
    public static Message parse(String json) throws JsonProcessingException {
        return MAPPER.readValue(json, Message.class);
    }
    
    public String toJson() throws JsonProcessingException {
        return MAPPER.writeValueAsString(this);
    }
    
    public <T> T getParamsAs(Class<T> clazz) {
        return MAPPER.convertValue(params, clazz);
    }
    
    // Getters and Setters
    public String getJsonrpc() { return jsonrpc; }
    public void setJsonrpc(String jsonrpc) { this.jsonrpc = jsonrpc; }
    
    public String getMethod() { return method; }
    public void setMethod(String method) { this.method = method; }
    
    public Object getParams() { return params; }
    public void setParams(Object params) { this.params = params; }
    
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    
    public Object getResult() { return result; }
    public void setResult(Object result) { this.result = result; }
    
    public RpcError getError() { return error; }
    public void setError(RpcError error) { this.error = error; }
    
    /**
     * JSON-RPC error object.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class RpcError {
        private int code;
        private String message;
        private Object data;
        
        public int getCode() { return code; }
        public void setCode(int code) { this.code = code; }
        
        public String getMessage() { return message; }
        public void setMessage(String message) { this.message = message; }
        
        public Object getData() { return data; }
        public void setData(Object data) { this.data = data; }
    }
}

/**
 * Registration parameters for sentinel connection.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
class RegistrationParams {
    private String layer;
    private String role;
    private int priority;
    private List<String> capabilities;
    private List<String> selectors;
    private String version;
    private String authToken;
    
    public String getLayer() { return layer; }
    public void setLayer(String layer) { this.layer = layer; }

    public String getRole() { return role; }
    public void setRole(String role) { this.role = role; }
    
    public int getPriority() { return priority; }
    public void setPriority(int priority) { this.priority = priority; }
    
    public List<String> getCapabilities() { return capabilities; }
    public void setCapabilities(List<String> capabilities) { this.capabilities = capabilities; }
    
    public List<String> getSelectors() { return selectors; }
    public void setSelectors(List<String> selectors) { this.selectors = selectors; }

    public String getVersion() { return version; }
    public void setVersion(String version) { this.version = version; }
    
    public String getAuthToken() { return authToken; }
    public void setAuthToken(String authToken) { this.authToken = authToken; }
}

/**
 * Pre-check parameters sent by Hub.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
class PreCheckParams {
    private CommandInfo command;
    private List<BlockingElement> blocking;
    private String screenshot;
    private String url;
    
    public CommandInfo getCommand() { return command; }
    public void setCommand(CommandInfo command) { this.command = command; }
    
    public List<BlockingElement> getBlocking() { return blocking; }
    public void setBlocking(List<BlockingElement> blocking) { this.blocking = blocking; }
    
    public String getScreenshot() { return screenshot; }
    public void setScreenshot(String screenshot) { this.screenshot = screenshot; }
    
    public String getUrl() { return url; }
    public void setUrl(String url) { this.url = url; }
}

/**
 * Command information in pre-check.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
class CommandInfo {
    private String cmd;
    private String goal;
    private String selector;
    private String value;
    private Integer stabilityHint;
    
    public String getCmd() { return cmd; }
    public void setCmd(String cmd) { this.cmd = cmd; }
    
    public String getGoal() { return goal; }
    public void setGoal(String goal) { this.goal = goal; }
    
    public String getSelector() { return selector; }
    public void setSelector(String selector) { this.selector = selector; }
    
    public String getValue() { return value; }
    public void setValue(String value) { this.value = value; }
    
    public Integer getStabilityHint() { return stabilityHint; }
    public void setStabilityHint(Integer stabilityHint) { this.stabilityHint = stabilityHint; }
}

/**
 * Blocking element detected by Hub.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
class BlockingElement {
    private String selector;
    private String tag;
    private String classes;
    private String text;
    
    public String getSelector() { return selector; }
    public void setSelector(String selector) { this.selector = selector; }
    
    public String getTag() { return tag; }
    public void setTag(String tag) { this.tag = tag; }
    
    public String getClasses() { return classes; }
    public void setClasses(String classes) { this.classes = classes; }
    
    public String getText() { return text; }
    public void setText(String text) { this.text = text; }
}

/**
 * Entropy stream data from Hub.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
class EntropyStreamParams {
    private boolean entropy;
    private Integer mutationCount;
    private Integer networkPending;
    
    public boolean isEntropy() { return entropy; }
    public void setEntropy(boolean entropy) { this.entropy = entropy; }
    
    public Integer getMutationCount() { return mutationCount; }
    public void setMutationCount(Integer mutationCount) { this.mutationCount = mutationCount; }
    
    public Integer getNetworkPending() { return networkPending; }
    public void setNetworkPending(Integer networkPending) { this.networkPending = networkPending; }
}
