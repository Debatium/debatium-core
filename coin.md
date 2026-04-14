We will implement a coin system, it looks like this

| Package_ID  | Amount_Coin | Price_VND   | Bonus_Percent | Ghi chú              |
| :---------- | :---------- | :---------- | :------------ | :------------------- |
| **PKG_50**  | 50 Coins    | 50,000 VND  | 0%            | Gói cơ bản           |
| **PKG_100** | 100 Coins   | 100,000 VND | 0%            | Gói phổ thông        |
| **PKG_200** | 220 Coins   | 200,000 VND | 10%           | Thưởng thêm 20 Coins |
| **PKG_500** | 575 Coins   | 500,000 VND | 15%           | Thưởng thêm 75 Coins |

Freeze (Tạm giữ): Khi một Debater nhấn "Join/Book Spar", hệ thống tự động trừ Available_Balance và cộng vào Frozen_Balance.
Release (Giải ngân): Khi Ballot (Module 5) được Submit thành công -> Coin từ Frozen_Balance của Debater sẽ được chuyển sang Available_Balance của Judge (sau khi trừ phí sàn 10-20%).
Refund (Hoàn tiền): Nếu Spar bị hủy bởi Host/Judge hoặc do lỗi hệ thống -> Coin từ Frozen_Balance được trả về Available_Balance của Debater.

## Nạp tiền

User truy cập Wallet -> Chọn Gói nạp.
System tạo Transaction (Status: Pending) -> Hiển thị QR thanh toán/Cổng thanh toán.
User thực hiện thanh toán qua Ngân hàng/Ví điện tử.
Payment gửi xác nhận -> System cập nhật Available_Balance và đổi Status Transaction thành "Success".

## Thanh toán Spar
Debater: Nhấn "Confirm Spar".
System Check: Available_Balance >= Spar_Fee?
No: Hiển thị thông báo "Số dư không đủ" -> Redirect tới Top-up.
Yes: Thực hiện lệnh Freeze -> Trừ Available_Balance, cộng Frozen_Balance.

We will use payos for processing, all the docs are in the pay-os-demo
