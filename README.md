# ⚡ Peer-to-Peer Solar Energy Marketplace

Welcome to a decentralized platform revolutionizing renewable energy trading! This Web3 project enables households with solar panels to sell excess energy directly to neighbors or other consumers via the Stacks blockchain. By leveraging smart contracts and tokens, it eliminates intermediaries, reduces costs, and promotes sustainable energy distribution in a transparent, trustless manner.

## ✨ Features
🌞 Register as a producer or consumer with verified credentials  
💡 Tokenize excess energy as fungible tokens representing kWh units  
📈 List and browse energy sell offers in a dynamic marketplace  
🤝 Secure peer-to-peer trades with automated escrow and payments  
🔍 Oracle integration for real-world energy delivery verification  
🏆 Reputation system to build trust among participants  
⚖️ Dispute resolution for fair handling of conflicts  
📊 Governance for community-driven platform updates  
🔒 Immutable records of all transactions and energy transfers  
🌍 Solves real-world problems like energy waste, high utility fees, and limited access for small-scale producers

## 🛠 How It Works
This project is built using Clarity smart contracts on the Stacks blockchain. It involves 8 interconnected smart contracts to handle various aspects of the marketplace securely and efficiently:

1. **UserRegistry.clar**: Manages user registration, profiles, and roles (producers/consumers). Ensures only verified users participate.
2. **EnergyToken.clar**: Implements a SIP-10 fungible token standard for representing energy units (e.g., 1 token = 1 kWh). Handles minting based on verified production.
3. **Marketplace.clar**: Allows producers to list sell offers with price, quantity, and duration. Consumers can browse and select offers.
4. **TradeEscrow.clar**: Holds buyer funds (in STX or stablecoins) in escrow until energy delivery is confirmed, then releases to seller.
5. **EnergyOracle.clar**: Integrates with external oracles to verify real-world energy production and transfer (e.g., via IoT meter data hashes).
6. **ReputationSystem.clar**: Tracks user ratings, successful trades, and stakes tokens for reputation boosts or penalties.
7. **DisputeResolution.clar**: Enables arbitration for disputes, with community voting or automated rules to resolve claims.
8. **GovernanceDAO.clar**: A DAO contract for proposing and voting on platform upgrades, fee changes, or parameter adjustments.

**For Producers (Households with Solar Panels)**  
- Register your profile and verify your solar setup via UserRegistry.  
- Mint EnergyTokens by submitting proof of excess production (hashed meter data) through EnergyOracle.  
- List your excess energy on the Marketplace with a price per kWh.  
- Once a buyer accepts, funds go into TradeEscrow. Deliver the energy off-chain (e.g., via local grid), and confirm via oracle.  
- Escrow releases payment upon verification—boom, you've monetized your solar surplus!

**For Consumers (Buyers)**  
- Register via UserRegistry to browse the Marketplace.  
- Select an offer, pay with STX/stablecoins into TradeEscrow.  
- Receive energy off-chain, and confirm receipt via EnergyOracle.  
- Rate the producer in ReputationSystem for future trust.

**For Verifiers/Community**  
- Use GovernanceDAO to vote on proposals.  
- Check transaction history or dispute claims via DisputeResolution.  
- Query any contract for transparent details, like get-offer-details in Marketplace or verify-energy-transfer in EnergyOracle.

That's it! A seamless, blockchain-powered solution to empower local energy economies and combat climate change.