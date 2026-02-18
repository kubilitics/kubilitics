import React, { useState, useRef, useEffect } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useLocation, Link } from 'react-router-dom';
import { MessageCircle, X, Send, Trash2, Settings } from 'lucide-react';
import { buildChatWSUrl } from '@/services/aiService';
import { useOfflineMode } from '@/hooks/useOfflineMode';
import { useAIStatus } from '@/hooks/useAIStatus';
import { analyticsService } from '@/services/analyticsService';
import { isTauri } from '@/lib/tauri';
// AI WebSocket endpoint (/ws/chat) lives on the AI backend (port 8081).
// Use buildChatWSUrl() from aiService for consistent URL construction.

export function AIAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const { aiBackendReachable } = useOfflineMode();
  const aiStatus = useAIStatus();

  // WebSocket connection — use buildChatWSUrl() so the correct AI backend
  // port (8081) and any query-string context params are included.
  const {
    messages,
    isConnected,
    isConnecting,
    sendUserMessage,
    clearMessages,
  } = useWebSocket({
    url: buildChatWSUrl(),
    autoConnect: false, // Connect only when chat is opened
  });

  // Get current context from URL
  const getContext = () => {
    const pathname = location.pathname;
    const parts = pathname.split('/');

    // Extract namespace, resource type, and name from URL
    // Example: /namespaces/production/pods/nginx-123
    let namespace = '';
    let resourceType = '';
    let resourceName = '';
    let screen = 'dashboard';

    const namespaceIndex = parts.indexOf('namespaces');
    if (namespaceIndex !== -1 && parts[namespaceIndex + 1]) {
      namespace = parts[namespaceIndex + 1];
    }

    if (parts.length >= 4) {
      resourceType = parts[namespaceIndex + 2] || '';
      resourceName = parts[namespaceIndex + 3] || '';
      screen = `${resourceType}-detail`;
    } else if (parts.length === 3) {
      screen = `${parts[namespaceIndex + 2]}-list`;
    }

    return {
      namespace,
      resource_type: resourceType,
      resource_name: resourceName,
      screen,
    };
  };

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  // Keyboard shortcut: Cmd/Ctrl + K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }

      // ESC to close
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleSend = () => {
    if (!input.trim()) return;
    if (!aiBackendReachable) {
      // AI backend unavailable - don't send
      return;
    }

    const context = getContext();
    sendUserMessage(input, context);
    
    // Track feature usage
    if (isTauri()) {
      analyticsService.trackFeatureUsage('ai_assistant', 'message_sent');
    }
    
    setInput('');
  };

  // Track AI assistant opens
  useEffect(() => {
    if (isOpen && isTauri()) {
      analyticsService.trackFeatureUsage('ai_assistant', 'opened');
    }
  }, [isOpen]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Gate on AI status: hide assistant when AI backend is unavailable
  if (aiStatus.status === 'unavailable') {
    return null;
  }

  const showConfigurePrompt = aiStatus.status === 'unconfigured';

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200"
        title={showConfigurePrompt ? 'AI Assistant — Configure in Settings' : 'AI Assistant (Cmd/Ctrl + K)'}
      >
        <MessageCircle className="h-6 w-6 mx-auto" />
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-96 h-[600px] bg-white dark:bg-gray-800 rounded-lg shadow-2xl flex flex-col border border-gray-200 dark:border-gray-700">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center space-x-2">
              <MessageCircle className="h-5 w-5 text-blue-600" />
              <h3 className="font-semibold text-gray-900 dark:text-white">
                AI Assistant
              </h3>
              {isConnected && (
                <span className="flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
              )}
              {isConnecting && (
                <span className="text-xs text-gray-500">Connecting...</span>
              )}
            </div>
            <div className="flex items-center space-x-2">
              {messages.length > 0 && (
                <button
                  onClick={clearMessages}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  title="Clear conversation"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {showConfigurePrompt ? (
              <div className="text-center text-gray-500 dark:text-gray-400 mt-8 px-4">
                <Settings className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-sm font-medium">AI is not configured</p>
                <p className="text-xs mt-2">
                  Configure your LLM provider and API key in Settings to use the AI assistant.
                </p>
                <Link
                  to="/settings"
                  className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700"
                  onClick={() => setIsOpen(false)}
                >
                  <Settings className="h-4 w-4" />
                  Open Settings
                </Link>
              </div>
            ) : messages.length === 0 && (
              <div className="text-center text-gray-500 dark:text-gray-400 mt-8">
                <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-sm">
                  Hi! I'm your AI assistant for Kubernetes.
                </p>
                <p className="text-xs mt-2">
                  Ask me anything about your cluster, resources, or errors.
                </p>
                {location.pathname !== '/' && (
                  <p className="text-xs mt-2 text-blue-600 dark:text-blue-400">
                    I can see you're viewing: {location.pathname}
                  </p>
                )}
              </div>
            )}

            {!showConfigurePrompt && messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`rounded-lg px-4 py-2 max-w-[85%] ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : msg.role === 'system'
                      ? 'bg-red-100 dark:bg-red-900 text-red-900 dark:text-red-100'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  {msg.timestamp && (
                    <p className="text-xs mt-1 opacity-70">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {!showConfigurePrompt && messages.length > 0 && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex justify-start">
                <div className="bg-gray-100 dark:bg-gray-700 rounded-lg px-4 py-2">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input — hidden when AI is unconfigured (user must go to Settings) */}
          {!showConfigurePrompt && (
          <div className="p-4 border-t border-gray-200 dark:border-gray-700">
            {!aiBackendReachable && (
              <div className="mb-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
                AI backend is unavailable. AI features are disabled.
              </div>
            )}
            {aiBackendReachable && !isConnected && !isConnecting && (
              <div className="mb-2 text-xs text-red-500 dark:text-red-400">
                Not connected to AI backend. Check if the server is running.
              </div>
            )}
            <div className="flex items-center space-x-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={aiBackendReachable ? "Ask me anything..." : "AI backend unavailable"}
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                disabled={!isConnected || !aiBackendReachable}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || !isConnected || !aiBackendReachable}
                className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Press <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">Enter</kbd> to send, <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">Cmd+K</kbd> to toggle
            </p>
          </div>
          )}
        </div>
      )}
    </>
  );
}
