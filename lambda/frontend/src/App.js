import React, { useState, useEffect, useRef } from 'react';
import { API, graphqlOperation } from 'aws-amplify';
import ReactMarkdown from 'react-markdown';
import { v4 as uuidv4 } from 'uuid';

// GraphQL queries and mutations
const sendMessage = /* GraphQL */ `
  mutation SendMessage($workflowId: ID!, $message: String!) {
    sendMessage(workflowId: $workflowId, message: $message) {
      workflowId
      status
      
    }
  }
`;

const onWorkflowComplete = /* GraphQL */ `
  subscription OnWorkflowComplete($workflowId: ID!) {
    onWorkflowComplete(workflowId: $workflowId) {
      workflowId
      result
    }
  }
`;

function App() {
  const [userInput, setUserInput] = useState('');
  const [workflowId, setWorkflowId] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Chat-specific state
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  
  // Refs to store subscription objects
  const resultSubscriptionRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Effect to scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Generate a unique session ID when the component mounts
  useEffect(() => {
    // Generate a new workflow ID on every page refresh
    // We intentionally don't check for stored workflow ID to ensure a fresh ID on refresh
    
    // Clear any previous workflow data from session storage
    sessionStorage.removeItem('workflowId');
    sessionStorage.removeItem('workflowStatus');
    sessionStorage.removeItem('chatMessages');
    
    // Reset all state related to previous workflows
    setWorkflowId(null);
    setStatus(null);
    setMessages([]);
    
    // Clean up any existing subscriptions
    cleanupSubscriptions();
  }, []);
  // Effect to check for workflow completion manually as a fallback
  useEffect(() => {
    // No need for manual polling as we're relying on the subscription
  }, [workflowId, status]);
  
  // Effect to persist messages in session storage
  useEffect(() => {
    if (messages.length > 0) {
      sessionStorage.setItem('chatMessages', JSON.stringify(messages));
    }
  }, [messages]);

  // Effect to restore messages from session storage
  useEffect(() => {
    const storedMessages = sessionStorage.getItem('chatMessages');
    if (storedMessages) {
      try {
        const parsedMessages = JSON.parse(storedMessages);
        if (Array.isArray(parsedMessages) && parsedMessages.length > 0) {
          console.log('Restoring messages from session storage:', parsedMessages);
          setMessages(parsedMessages);
        }
      } catch (err) {
        console.error('Error parsing stored messages:', err);
      }
    }
  }, []);
  
  // We're removing the status check function as we'll rely on subscriptions
  // Clean up subscriptions
  const cleanupSubscriptions = () => {
    console.log('Cleaning up subscriptions');
    if (resultSubscriptionRef.current) {
      console.log('Unsubscribing from result updates');
      resultSubscriptionRef.current.unsubscribe();
      resultSubscriptionRef.current = null;
    }
  };

  // Handle new conversation or continue existing one
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!userInput.trim()) return;

    try {
      // Add user message to chat
      const newUserMessage = {
        id: Date.now(),
        text: userInput,
        sender: 'user',
        timestamp: new Date().toISOString()
      };
      
      console.log('Adding user message to chat:', newUserMessage);
      setMessages(prevMessages => [...prevMessages, newUserMessage]);
      
      setLoading(true);
      setIsTyping(true);
      setError(null);
      
      // If no workflow ID exists, generate a new one
      let currentWorkflowId = workflowId;
      if (!currentWorkflowId) {
        currentWorkflowId = uuidv4();
        console.log('Generated new workflow ID:', currentWorkflowId);
        setWorkflowId(currentWorkflowId);
        
        // Subscribe to workflow completion
        subscribeToUpdates(currentWorkflowId);
        
        // Add a small delay to ensure subscriptions are set up
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Store the workflow ID in session storage
        sessionStorage.setItem('workflowId', currentWorkflowId);
        setStatus('STARTING');
      }
      
      // Always use sendMessage for all interactions
      console.log('Sending message to workflow:', currentWorkflowId, userInput);
      const response = await API.graphql(graphqlOperation(sendMessage, {
        workflowId: currentWorkflowId,
        message: userInput
      }));
      
      console.log('Message sent response:', response);
      
      // Process the response from sendMessage
      if (response.data.sendMessage) {
        const messageData = response.data.sendMessage;
        setStatus(messageData.status);
        sessionStorage.setItem('workflowStatus', messageData.status);
        
        // We'll rely on subscriptions for agent messages
        // No need to check for messageToUser or waitingForFeedback here
      }
      
      // Clear input field
      setUserInput('');
      
    } catch (err) {
      console.error('Error sending message:', err);
      setError('Failed to send message. Please try again.');
      setIsTyping(false);
    } finally {
      setLoading(false);
    }
  };

  // Send a message for the current workflow
  const handleMessageSubmit = async (e) => {
    e.preventDefault();
    if (!userInput.trim()) return;

    try {
      // Add user message to chat
      const newUserMessage = {
        id: Date.now(),
        text: userInput,
        sender: 'user',
        timestamp: new Date().toISOString()
      };
      
      console.log('Adding user message to chat (feedback):', newUserMessage);
      setMessages(prevMessages => [...prevMessages, newUserMessage]);
      
      setLoading(true);
      setIsTyping(true);
      setError(null);
      
      // If no workflow ID exists, generate a new one
      let currentWorkflowId = workflowId;
      if (!currentWorkflowId) {
        currentWorkflowId = uuidv4();
        console.log('Generated new workflow ID:', currentWorkflowId);
        setWorkflowId(currentWorkflowId);
        
        // Subscribe to real-time updates
        subscribeToUpdates(currentWorkflowId);
        
        // Store the workflow ID in session storage
        sessionStorage.setItem('workflowId', currentWorkflowId);
      }
      
      console.log('Sending message to workflow:', currentWorkflowId, userInput);
      const response = await API.graphql(graphqlOperation(sendMessage, {
        workflowId: currentWorkflowId,
        message: userInput
      }));
      
      console.log('Message sent response:', response);
      setStatus(response.data.sendMessage.status);
      sessionStorage.setItem('workflowStatus', response.data.sendMessage.status);
      
      setUserInput('');
      
    } catch (err) {
      console.error('Error sending message:', err);
      setError('Failed to send message. Please try again.');
      setIsTyping(false);
    } finally {
      setLoading(false);
    }
  };

  // Subscribe to workflow completion
  const subscribeToUpdates = (id) => {
    // Clean up any existing subscriptions first
    cleanupSubscriptions();
    
    console.log('Subscribing to completion for workflow ID:', id);
    
    try {
      // Subscribe to completion events
      resultSubscriptionRef.current = API.graphql({
        query: onWorkflowComplete,
        variables: { workflowId: id },
        authMode: 'API_KEY'
      }).subscribe({
        next: (response) => {
          console.log('Workflow completion raw response:', response);
          if (response && response.value && response.value.data && response.value.data.onWorkflowComplete) {
            const resultData = response.value.data.onWorkflowComplete;
            console.log('Received workflow completion:', resultData);
            setIsTyping(false);
            
            // Add the final result as a message from the agent
            const finalResultMessage = {
              id: Date.now(),
              text: resultData.result,
              sender: 'agent',
              timestamp: new Date().toISOString(),
              isFinal: true
            };
            
            setMessages(prevMessages => {
              console.log('Previous messages before final:', prevMessages);
              const updatedMessages = [...prevMessages, finalResultMessage];
              console.log('Updated messages with final:', updatedMessages);
              return updatedMessages;
            });
            setStatus('COMPLETED');
            sessionStorage.setItem('workflowStatus', 'COMPLETED');
          } else {
            console.error('Unexpected workflow completion response format:', response);
          }
        },
        error: (err) => console.error('Result subscription error:', err)
      });
      
      console.log('Completion subscription created successfully');
    } catch (error) {
      console.error('Error setting up subscriptions:', error);
    }
  };

  // Clean up subscriptions on unmount
  useEffect(() => {
    return () => {
      cleanupSubscriptions();
    };
  }, []);

  // Reset the workflow
  const resetWorkflow = () => {
    setUserInput('');
    setWorkflowId(null);
    setStatus(null);
    setMessages([]);
    setIsTyping(false);
    
    // Clear session storage
    sessionStorage.removeItem('workflowId');
    sessionStorage.removeItem('workflowStatus');
    sessionStorage.removeItem('chatMessages');
    
    // Clean up subscriptions
    cleanupSubscriptions();
  };

  return (
    <div className="container">
      <div className="header">
        <h1>AI Agent Chat</h1>
        <p>Chat with the LangGraph agent workflow</p>
      </div>

      {/* Chat container */}
      <div className="chat-container">
        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="empty-chat">
              <p>Start a conversation with the AI agent</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div 
                key={msg.id} 
                className={`message ${msg.sender === 'user' ? 'user-message' : 'agent-message'}`}
              >
                <div className="message-content">
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>
                <div className="message-timestamp">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))
          )}
          
          {/* Typing indicator */}
          {isTyping && (
            <div className="message agent-message typing-indicator">
              <div className="typing-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          )}
          
          {/* Invisible element to scroll to */}
          <div ref={messagesEndRef} />
        </div>

        {/* Input form */}
        <form className="chat-input-form" onSubmit={handleSubmit}>
          <textarea
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="Type your message..."
            disabled={loading && !isTyping}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (userInput.trim()) {
                  handleSubmit(e);
                }
              }
            }}
          />
          <button 
            type="submit" 
            disabled={(loading && !isTyping) || !userInput.trim()}
          >
            Send
          </button>
        </form>
      </div>

      {/* Error message */}
      {error && (
        <div className="error-message">
          <p>{error}</p>
        </div>
      )}
      
      {/* Status display (can be hidden in production) */}
      {workflowId && (
        <div className="status-info">
          <p><strong>Workflow ID:</strong> {workflowId}</p>
          <p><strong>Status:</strong> {status || 'Unknown'}</p>
        </div>
      )}
      
      {/* Reset button */}
      {status === 'COMPLETED' && (
        <button 
          onClick={resetWorkflow}
          className="reset-button"
        >
          Start New Conversation
        </button>
      )}
    </div>
  );
}

export default App;
