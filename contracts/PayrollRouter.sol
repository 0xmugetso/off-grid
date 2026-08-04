// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title OffGrid Payroll Router (prototype)
/// @notice Records an idempotent payroll commitment and fans Arc USDC out to
///         wallet recipients and licensed off-ramp settlement accounts.
/// @dev Amounts use the 6-decimal USDC ERC-20 interface. This prototype has
///      not been audited and must not be deployed with production funds.
contract PayrollRouter {
    struct Payout {
        address recipient;
        uint256 amount;
        bytes32 instructionHash;
    }

    IERC20 public immutable usdc;
    mapping(bytes32 batchId => bool executed) public executedBatches;

    error EmptyBatch();
    error BatchAlreadyExecuted(bytes32 batchId);
    error InvalidPayout(uint256 index);
    error TransferFailed(uint256 index);

    event PayrollExecuted(
        bytes32 indexed batchId,
        address indexed employer,
        uint256 payoutCount,
        uint256 totalUsdc,
        bytes32 manifestHash
    );
    event PayoutRouted(
        bytes32 indexed batchId,
        uint256 indexed index,
        address indexed recipient,
        uint256 amount,
        bytes32 instructionHash
    );

    constructor(address usdcAddress) {
        if (usdcAddress == address(0)) revert InvalidPayout(0);
        usdc = IERC20(usdcAddress);
    }

    function executePayroll(bytes32 batchId, Payout[] calldata payouts, bytes32 manifestHash) external {
        if (payouts.length == 0) revert EmptyBatch();
        if (executedBatches[batchId]) revert BatchAlreadyExecuted(batchId);

        // Set before external calls. A revert rolls this write back atomically.
        executedBatches[batchId] = true;
        uint256 total;

        for (uint256 i; i < payouts.length; ++i) {
            Payout calldata payout = payouts[i];
            if (payout.recipient == address(0) || payout.amount == 0) revert InvalidPayout(i);
            total += payout.amount;
            if (!usdc.transferFrom(msg.sender, payout.recipient, payout.amount)) revert TransferFailed(i);
            emit PayoutRouted(batchId, i, payout.recipient, payout.amount, payout.instructionHash);
        }

        emit PayrollExecuted(batchId, msg.sender, payouts.length, total, manifestHash);
    }
}
