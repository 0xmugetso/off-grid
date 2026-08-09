// SPDX-License-Identifier: Apache-2.0
/*
 * Copyright 2025 Circle Internet Group, Inc. All rights reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract RefundProtocol is EIP712 {
    struct Payment {
        address to;
        uint256 amount;
        uint256 releaseTimestamp;
        address refundTo;
        uint256 withdrawnAmount;
        bool refunded;
    }

    bytes32 public constant EARLY_WITHDRAWAL_TYPEHASH = keccak256(
        "EarlyWithdrawalByArbiter(uint256[] paymentIDs,uint256[] withdrawalAmounts,uint256 feeAmount,uint256 expiry,uint256 salt)"
    );

    IERC20 public fiatToken;
    uint256 public nonce;
    address public arbiter;
    mapping(uint256 => Payment) public payments;
    mapping(address => uint256) public balances;
    mapping(address => uint256) public debts;
    mapping(bytes32 => bool) public withdrawalHashes;

    event PaymentCreated(
        uint256 indexed paymentID,
        address indexed to,
        uint256 amount,
        uint256 releaseTimestamp,
        address indexed refundTo
    );
    event Refund(uint256 indexed paymentID, address indexed refundTo, uint256 amount);
    event RefundToUpdated(uint256 indexed paymentID, address indexed oldRefundTo, address indexed newRefundTo);
    event Withdrawal(address indexed to, uint256 amount);
    event WithdrawalFeePaid(address indexed recipient, uint256 amount);

    error CallerNotAllowed();
    error PaymentDoesNotBelongToRecipient();
    error RefundToIsZeroAddress();
    error InsufficientFunds();
    error InvalidWithdrawalAmount(uint256 paymentID, uint256 withdrawalAmount);
    error InvalidFeeAmount();
    error InvalidSignature();
    error WithdrawalHashAlreadyUsed();
    error WithdrawalHashExpired();
    error PaymentRefunded(uint256 paymentID);
    error MismatchedEarlyWithdrawalArrays();

    constructor(address _arbiter, address _usdc, string memory eip712Name, string memory eip712version)
        EIP712(eip712Name, eip712version)
    {
        arbiter = _arbiter;
        fiatToken = IERC20(_usdc);
        nonce = 0;
    }

    modifier onlyArbiter() {
        if (msg.sender != arbiter) revert CallerNotAllowed();
        _;
    }

    function DOMAIN_SEPARATOR() external view virtual returns (bytes32) {
        return _domainSeparatorV4();
    }

    function pay(address to, uint256 amount, address refundTo) external {
        if (refundTo == address(0)) revert RefundToIsZeroAddress();

        fiatToken.transferFrom(msg.sender, address(this), amount);
        payments[nonce] = Payment(to, amount, block.timestamp, refundTo, 0, false);
        balances[to] += amount;

        emit PaymentCreated(nonce, to, amount, block.timestamp, refundTo);
        nonce += 1;
    }

    function refundByRecipient(uint256 paymentID) external {
        Payment memory payment = payments[paymentID];
        if (msg.sender != payment.to) revert CallerNotAllowed();

        uint256 recipientBalance = balances[payment.to];
        if (payment.amount > recipientBalance) revert InsufficientFunds();
        balances[payment.to] = recipientBalance - payment.amount;

        _executeRefund(paymentID, payment);
    }

    function refundByArbiter(uint256 paymentID) external onlyArbiter {
        Payment memory payment = payments[paymentID];
        uint256 recipientBalance = balances[payment.to];

        if (payment.amount <= recipientBalance) {
            balances[payment.to] = recipientBalance - payment.amount;
            return _executeRefund(paymentID, payment);
        }

        uint256 arbiterBalance = balances[arbiter];
        if (payment.amount > arbiterBalance) revert InsufficientFunds();

        balances[arbiter] = arbiterBalance - payment.amount;
        debts[payment.to] += payment.amount;
        _executeRefund(paymentID, payment);
    }

    function settleDebt(address recipient) external {
        _settleDebt(recipient);
    }

    function depositArbiterFunds(uint256 amount) external onlyArbiter {
        fiatToken.transferFrom(msg.sender, address(this), amount);
        balances[arbiter] += amount;
    }

    function withdrawArbiterFunds(uint256 amount) external onlyArbiter {
        uint256 arbiterBalance = balances[arbiter];
        if (amount > arbiterBalance) revert InsufficientFunds();

        balances[arbiter] = arbiterBalance - amount;
        fiatToken.transfer(arbiter, amount);
    }

    function withdraw(uint256[] calldata paymentIDs) external {
        _settleDebt(msg.sender);
        uint256 totalAmount = 0;

        for (uint256 i = 0; i < paymentIDs.length; ++i) {
            Payment memory payment = payments[paymentIDs[i]];
            if (payment.to != msg.sender) revert CallerNotAllowed();
            if (payment.refunded) revert PaymentRefunded(paymentIDs[i]);
            totalAmount += payment.amount - payment.withdrawnAmount;
            payments[paymentIDs[i]].withdrawnAmount = payment.amount;
        }

        uint256 recipientBalance = balances[msg.sender];
        if (totalAmount > recipientBalance) revert InsufficientFunds();
        balances[msg.sender] = recipientBalance - totalAmount;
        fiatToken.transfer(msg.sender, totalAmount);
        emit Withdrawal(msg.sender, totalAmount);
    }

    function earlyWithdrawByArbiter(
        uint256[] calldata paymentIDs,
        uint256[] calldata withdrawalAmounts,
        uint256 feeAmount,
        uint256 expiry,
        uint256 salt,
        address recipient,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyArbiter {
        bytes32 withdrawalInfoHash = _hashEarlyWithdrawalInfo(paymentIDs, withdrawalAmounts, feeAmount, expiry, salt);
        if (withdrawalHashes[withdrawalInfoHash]) revert WithdrawalHashAlreadyUsed();
        if (ecrecover(withdrawalInfoHash, v, r, s) != recipient) revert InvalidSignature();
        if (block.timestamp > expiry) revert WithdrawalHashExpired();
        if (paymentIDs.length != withdrawalAmounts.length) revert MismatchedEarlyWithdrawalArrays();

        uint256 totalAmount = 0;
        for (uint256 i = 0; i < paymentIDs.length; ++i) {
            uint256 paymentID = paymentIDs[i];
            uint256 withdrawalAmount = withdrawalAmounts[i];
            Payment memory payment = payments[paymentID];

            if (withdrawalAmount > payment.amount) revert InvalidWithdrawalAmount(paymentID, withdrawalAmount);
            if (payment.to != recipient) revert PaymentDoesNotBelongToRecipient();
            if (payment.refunded) revert PaymentRefunded(paymentID);
            totalAmount += withdrawalAmount;
            payments[paymentID].withdrawnAmount += withdrawalAmount;
        }

        if (feeAmount > totalAmount) revert InvalidFeeAmount();
        uint256 recipientBalance = balances[recipient];
        if (recipientBalance < totalAmount) revert InsufficientFunds();
        balances[recipient] = recipientBalance - totalAmount;
        balances[arbiter] += feeAmount;

        fiatToken.transfer(recipient, totalAmount - feeAmount);
        emit Withdrawal(recipient, totalAmount);
        emit WithdrawalFeePaid(recipient, feeAmount);
        withdrawalHashes[withdrawalInfoHash] = true;
    }

    function updateRefundTo(uint256 paymentID, address newRefundTo) external {
        if (newRefundTo == address(0)) revert RefundToIsZeroAddress();
        Payment memory payment = payments[paymentID];
        if (msg.sender != payment.refundTo) revert CallerNotAllowed();
        emit RefundToUpdated(paymentID, payment.refundTo, newRefundTo);
        payments[paymentID].refundTo = newRefundTo;
    }

    function hashEarlyWithdrawalInfo(
        uint256[] calldata paymentIDs,
        uint256[] calldata withdrawalAmounts,
        uint256 feeAmount,
        uint256 expiry,
        uint256 salt
    ) external view returns (bytes32) {
        return _hashEarlyWithdrawalInfo(paymentIDs, withdrawalAmounts, feeAmount, expiry, salt);
    }

    function _executeRefund(uint256 paymentID, Payment memory payment) internal {
        if (payment.refunded) revert PaymentRefunded(paymentID);
        fiatToken.transfer(payment.refundTo, payment.amount);
        payments[paymentID].refunded = true;
        emit Refund(paymentID, payment.refundTo, payment.amount);
    }

    function _settleDebt(address recipient) internal {
        uint256 recipientDebt = debts[recipient];
        uint256 recipientBalance = balances[recipient];
        uint256 settleAmount = recipientBalance < recipientDebt ? recipientBalance : recipientDebt;

        balances[recipient] = recipientBalance - settleAmount;
        balances[arbiter] += settleAmount;
        debts[recipient] = recipientDebt - settleAmount;
    }

    function _hashEarlyWithdrawalInfo(
        uint256[] calldata paymentIDs,
        uint256[] calldata withdrawalAmounts,
        uint256 feeAmount,
        uint256 expiry,
        uint256 salt
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(EARLY_WITHDRAWAL_TYPEHASH, paymentIDs, withdrawalAmounts, feeAmount, expiry, salt)
        );
        return _hashTypedDataV4(structHash);
    }
}
