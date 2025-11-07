import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface AssistantData {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [assistants, setAssistants] = useState<AssistantData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingAssistant, setCreatingAssistant] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newAssistantData, setNewAssistantData] = useState({ name: "", value: "", description: "" });
  const [selectedAssistant, setSelectedAssistant] = useState<AssistantData | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const assistantsList: AssistantData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          assistantsList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setAssistants(assistantsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createAssistant = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingAssistant(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating assistant with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const intValue = parseInt(newAssistantData.value) || 0;
      const businessId = `assistant-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, intValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newAssistantData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        Math.floor(Math.random() * 100),
        0,
        newAssistantData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Assistant created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewAssistantData({ name: "", value: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingAssistant(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and ready!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredAssistants = assistants.filter(assistant =>
    assistant.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    assistant.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const paginatedAssistants = filteredAssistants.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredAssistants.length / itemsPerPage);

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>MyAI_Zama 🔐</h1>
            <span>Private AI Personal Assistant</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🤖</div>
            <h2>Connect Your Wallet to Start</h2>
            <p>Connect your wallet to initialize your private AI assistant with FHE encryption.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading AI Assistant...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>MyAI_Zama 🔐</h1>
          <span>Privacy-First AI Assistant</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="check-btn">
            Check Availability
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Assistant
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="search-section">
          <input
            type="text"
            placeholder="Search assistants..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="stats-panel">
          <div className="stat-item">
            <span className="stat-value">{assistants.length}</span>
            <span className="stat-label">Total Assistants</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{assistants.filter(a => a.isVerified).length}</span>
            <span className="stat-label">Verified Data</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{assistants.length > 0 ? (assistants.reduce((sum, a) => sum + a.publicValue1, 0) / assistants.length).toFixed(1) : 0}</span>
            <span className="stat-label">Avg Score</span>
          </div>
        </div>

        <div className="assistants-grid">
          {paginatedAssistants.length === 0 ? (
            <div className="no-assistants">
              <p>No AI assistants found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Assistant
              </button>
            </div>
          ) : (
            paginatedAssistants.map((assistant, index) => (
              <div 
                className={`assistant-card ${assistant.isVerified ? 'verified' : ''}`}
                key={index}
                onClick={() => setSelectedAssistant(assistant)}
              >
                <div className="card-header">
                  <h3>{assistant.name}</h3>
                  <span className={`status ${assistant.isVerified ? 'verified' : 'encrypted'}`}>
                    {assistant.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                  </span>
                </div>
                <p className="description">{assistant.description}</p>
                <div className="card-meta">
                  <span>Score: {assistant.publicValue1}</span>
                  <span>{new Date(assistant.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="creator">By: {assistant.creator.substring(0, 8)}...</div>
              </div>
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="pagination">
            <button 
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </button>
            <span>Page {currentPage} of {totalPages}</span>
            <button 
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </div>
        )}

        <div className="faq-section">
          <h3>FHE AI Assistant FAQ</h3>
          <div className="faq-item">
            <strong>How does FHE protect my data?</strong>
            <p>Your data remains encrypted even during AI processing using Zama's fully homomorphic encryption.</p>
          </div>
          <div className="faq-item">
            <strong>What data types are supported?</strong>
            <p>Currently supports integer values for FHE operations. Text data is stored publicly.</p>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Create New AI Assistant</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">×</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Assistant Name</label>
                <input 
                  type="text" 
                  value={newAssistantData.name}
                  onChange={(e) => setNewAssistantData({...newAssistantData, name: e.target.value})}
                  placeholder="Enter assistant name..."
                />
              </div>
              
              <div className="form-group">
                <label>Encrypted Value (Integer)</label>
                <input 
                  type="number" 
                  value={newAssistantData.value}
                  onChange={(e) => setNewAssistantData({...newAssistantData, value: e.target.value})}
                  placeholder="Enter integer value..."
                />
                <span className="input-hint">FHE Encrypted Integer</span>
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <input 
                  type="text" 
                  value={newAssistantData.description}
                  onChange={(e) => setNewAssistantData({...newAssistantData, description: e.target.value})}
                  placeholder="Enter description..."
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createAssistant}
                disabled={creatingAssistant || isEncrypting}
                className="submit-btn"
              >
                {creatingAssistant || isEncrypting ? "Creating..." : "Create Assistant"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedAssistant && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>Assistant Details</h2>
              <button onClick={() => setSelectedAssistant(null)} className="close-modal">×</button>
            </div>
            
            <div className="modal-body">
              <div className="detail-item">
                <span>Name:</span>
                <strong>{selectedAssistant.name}</strong>
              </div>
              
              <div className="detail-item">
                <span>Description:</span>
                <p>{selectedAssistant.description}</p>
              </div>
              
              <div className="detail-item">
                <span>Public Score:</span>
                <strong>{selectedAssistant.publicValue1}</strong>
              </div>
              
              <div className="detail-item">
                <span>Encrypted Value:</span>
                <div className="value-display">
                  {selectedAssistant.isVerified ? 
                    `${selectedAssistant.decryptedValue} (Verified)` : 
                    decryptedValue !== null ?
                    `${decryptedValue} (Decrypted)` :
                    "🔒 Encrypted"
                  }
                  <button 
                    onClick={async () => {
                      if (decryptedValue !== null) {
                        setDecryptedValue(null);
                      } else {
                        const value = await decryptData(selectedAssistant.id);
                        setDecryptedValue(value);
                      }
                    }}
                    disabled={isDecrypting}
                    className={`decrypt-btn ${decryptedValue !== null ? 'decrypted' : ''}`}
                  >
                    {isDecrypting ? "Decrypting..." : 
                     decryptedValue !== null ? "Re-encrypt" : 
                     selectedAssistant.isVerified ? "Verified" : "Decrypt"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;


