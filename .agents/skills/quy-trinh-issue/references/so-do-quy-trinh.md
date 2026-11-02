# Sơ đồ quy trình xử lý issue (đi kèm skill quy-trinh-issue)

```mermaid
flowchart TD
    A["Nhận issue"] --> B["GĐ0: Làm rõ yêu cầu<br/>chưa rõ thì hỏi lại người giao"]
    B --> C["GĐ1: phan-tich-issue<br/>viết phantich.md"]
    C --> D{"Người dùng<br/>duyệt phantich?"}
    D -->|"Chưa"| C
    D -->|"Duyệt"| E["GĐ2: Tạo nhánh từ main<br/>commit phantich.md — Bước 0"]
    E --> F["GĐ3: Lấy bước tiếp theo<br/>trong phantich"]
    F --> G["Chọn skill theo mảng:<br/>FE → lam-frontend · BE → lam-backend"]
    G --> H["Code đúng phạm vi bước<br/>+ comment tiếng Việt"]
    H --> I["Kiểm chứng ngay:<br/>viet-test hoặc cách thay thế<br/>ghi trong phantich"]
    I --> J{"Đạt?"}
    J -->|"Không đạt"| K["debug-loi:<br/>tìm nguyên nhân gốc → sửa"]
    K --> I
    J -->|"Đạt"| L["Commit riêng + push ngay<br/>báo SHA cho người dùng"]
    L --> M{"Còn bước?"}
    M -->|"Còn"| F
    M -->|"Hết"| N["GĐ4: Chạy toàn bộ test<br/>review-code soi diff"]
    N --> O["Mở PR vào main"]
    O --> P["GĐ5: Sửa theo review<br/>merge → đóng issue"]
```

**Cách đọc:** vòng lặp ở giữa (code → kiểm chứng → debug nếu chưa đạt → commit) là trái tim của quy trình. Mũi tên "Chưa duyệt" quay lại bước phân tích và vòng "Không đạt" quay lại bước kiểm chứng là hai vòng lặp bắt buộc — không có đường tắt đi xuyên qua chúng.
