pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PrivateAIPersonalAssistant is ZamaEthereumConfig {
    struct UserData {
        address owner;
        euint32 encryptedContext;
        uint256 publicMetadata;
        bool isActive;
        uint256 lastUpdated;
    }

    struct ModelOutput {
        euint32 encryptedSuggestion;
        uint256 confidenceScore;
        bool isProcessed;
    }

    mapping(address => UserData) private userRegistry;
    mapping(address => ModelOutput[]) private userSuggestions;
    mapping(address => bool) private registeredUsers;

    event UserRegistered(address indexed user, uint256 timestamp);
    event DataEncrypted(address indexed user, uint256 timestamp);
    event SuggestionGenerated(address indexed user, uint256 timestamp);
    event SuggestionDecrypted(address indexed user, uint256 timestamp);

    modifier onlyRegistered() {
        require(registeredUsers[msg.sender], "User not registered");
        _;
    }

    constructor() ZamaEthereumConfig() {
    }

    function registerUser() external {
        require(!registeredUsers[msg.sender], "User already registered");
        
        UserData storage userData = userRegistry[msg.sender];
        userData.owner = msg.sender;
        userData.isActive = true;
        userData.lastUpdated = block.timestamp;
        
        registeredUsers[msg.sender] = true;
        
        emit UserRegistered(msg.sender, block.timestamp);
    }

    function encryptUserData(externalEuint32 encryptedContext, bytes calldata inputProof, uint256 publicMetadata) 
        external 
        onlyRegistered 
    {
        require(FHE.isInitialized(FHE.fromExternal(encryptedContext, inputProof)), "Invalid encrypted input");
        
        UserData storage userData = userRegistry[msg.sender];
        userData.encryptedContext = FHE.fromExternal(encryptedContext, inputProof);
        userData.publicMetadata = publicMetadata;
        userData.lastUpdated = block.timestamp;
        
        FHE.allowThis(userData.encryptedContext);
        FHE.makePubliclyDecryptable(userData.encryptedContext);
        
        emit DataEncrypted(msg.sender, block.timestamp);
    }

    function generateSuggestion() external onlyRegistered {
        UserData storage userData = userRegistry[msg.sender];
        require(userData.isActive, "User account inactive");
        
        ModelOutput memory newSuggestion;
        newSuggestion.encryptedSuggestion = FHE.add(userData.encryptedContext, FHE.euint32From(0));
        newSuggestion.confidenceScore = 100; 
        newSuggestion.isProcessed = false;
        
        userSuggestions[msg.sender].push(newSuggestion);
        
        emit SuggestionGenerated(msg.sender, block.timestamp);
    }

    function decryptSuggestion(
        uint256 suggestionIndex,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external onlyRegistered {
        require(suggestionIndex < userSuggestions[msg.sender].length, "Invalid suggestion index");
        
        ModelOutput storage suggestion = userSuggestions[msg.sender][suggestionIndex];
        require(!suggestion.isProcessed, "Suggestion already processed");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(suggestion.encryptedSuggestion);
        
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        
        suggestion.isProcessed = true;
        
        emit SuggestionDecrypted(msg.sender, block.timestamp);
    }

    function getUserData() external view onlyRegistered returns (
        euint32 encryptedContext,
        uint256 publicMetadata,
        bool isActive,
        uint256 lastUpdated
    ) {
        UserData storage userData = userRegistry[msg.sender];
        return (
            userData.encryptedContext,
            userData.publicMetadata,
            userData.isActive,
            userData.lastUpdated
        );
    }

    function getUserSuggestions() external view onlyRegistered returns (ModelOutput[] memory) {
        return userSuggestions[msg.sender];
    }

    function checkRegistration(address user) external view returns (bool) {
        return registeredUsers[user];
    }

    function serviceAvailability() public pure returns (bool) {
        return true;
    }
}


