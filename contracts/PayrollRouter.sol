// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IGatewayMinter {
    function gatewayMint(bytes calldata attestation, bytes calldata signature) external;
}

/// @notice Atomic USDC payroll. Funds are pulled only from the transaction sender.
contract PayrollRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct Payout { address recipient; uint256 amount; }
    IERC20 public immutable usdc;
    IGatewayMinter public immutable gatewayMinter;
    mapping(address => mapping(bytes32 => bool)) public executedBatches;
    error InvalidBatch();
    error AlreadyExecuted();
    error IncorrectMint();
    event PayrollExecuted(address indexed employer, bytes32 indexed batchId, uint256 count, uint256 total);

    constructor(address token, address minter) {
        require(token != address(0) && minter != address(0));
        usdc = IERC20(token);
        gatewayMinter = IGatewayMinter(minter);
    }

    function executePayroll(bytes32 batchId, Payout[] calldata payouts) external nonReentrant {
        _pay(batchId, payouts);
    }

    /// @notice Compose Circle's mint and all payouts in one reverting transaction.
    /// The attestation must mint the exact payroll total to msg.sender.
    function mintAndExecutePayroll(bytes32 batchId, Payout[] calldata payouts, bytes calldata attestation, bytes calldata signature) external nonReentrant {
        uint256 total = _total(payouts);
        uint256 beforeBalance = usdc.balanceOf(msg.sender);
        gatewayMinter.gatewayMint(attestation, signature);
        if (usdc.balanceOf(msg.sender) != beforeBalance + total) revert IncorrectMint();
        _pay(batchId, payouts);
    }

    function _total(Payout[] calldata payouts) private view returns (uint256 total) {
        if (payouts.length == 0 || payouts.length > 50) revert InvalidBatch();
        for (uint256 i; i < payouts.length; ++i) {
            if (payouts[i].recipient == address(0) || payouts[i].recipient == address(this) || payouts[i].amount == 0) revert InvalidBatch();
            total += payouts[i].amount;
        }
    }

    function _pay(bytes32 batchId, Payout[] calldata payouts) private {
        uint256 total = _total(payouts);
        if (batchId == bytes32(0)) revert InvalidBatch();
        if (executedBatches[msg.sender][batchId]) revert AlreadyExecuted();
        executedBatches[msg.sender][batchId] = true;
        for (uint256 i; i < payouts.length; ++i) {
            usdc.safeTransferFrom(msg.sender, payouts[i].recipient, payouts[i].amount);
        }
        emit PayrollExecuted(msg.sender, batchId, payouts.length, total);
    }
}
