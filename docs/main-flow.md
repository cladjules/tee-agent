# Tee Agent Main Flow

Simple version of the main lifecycle.

We mainly use two AI-agent standards:

- **ERC-7857**: ownable intelligent data with encrypted private metadata.
- **ERC-8004**: agent identity, validation, and reputation.

```text
1. Mint Agent

   Owner
     -> App / SDK
     -> Phala TEE Oracle: get public key
     -> 0G Storage: upload encrypted private data
     -> AgentRegistry: mint ERC-7857 agent + ERC-8004 identity


2. Run Agent

   User
     -> App / SDK: signed request
     -> Phala TEE Oracle: decrypt private data inside TEE
     -> User: TEE-signed result


3. Validate Agent

   User
     -> ValidationRegistry: request validation
     -> Phala TEE Oracle: score inside TEE
     -> TeeVerifier: verify TDX proof
     -> Reputation: update on-chain score


4. Transfer Agent

   Sender
     -> Phala TEE Oracle: re-wrap keys for recipient oracle
     -> Recipient: signs acceptance proofs
     -> AgentRegistry: transfer ERC-7857 agent + ERC-8004 identity
     -> Recipient Oracle: can decrypt after transfer
```

Core idea: the app coordinates the flow, but private data is only decrypted
inside the TEE, and ownership/reputation stay on-chain.
