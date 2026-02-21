# 📦 Phiên bản & Hướng dẫn Cài đặt (Package Versions & Installation)

Tài liệu này cung cấp hướng dẫn chi tiết về các phiên bản của **MP Sentinel** và cách xử lý khi gặp lỗi trong quá trình cài đặt qua `npm`.

---

## 🚀 Các phiên bản hiện có (Available Versions)

Bạn có thể cài đặt một phiên bản cụ thể bằng cách thêm `@version` vào sau tên package.

| Phiên bản | Trạng thái | Ghi chú                                                      | Lệnh cài đặt                       |
| :-------- | :--------- | :----------------------------------------------------------- | :--------------------------------- |
| **1.0.3** | `Latest`   | Đồng bộ phiên bản, cải tiến build và Prettier. | `npm install -g mp-sentinel@1.0.3` |
| **1.0.2** | `Stable`   | Tích hợp Skills.sh, xử lý song song cải tiến, bảo mật 3 lớp. | `npm install -g mp-sentinel@1.0.2` |
| **1.0.1** | `Legacy`   | Thêm Branch Diff Mode, cải thiện khớp mẫu commit.            | `npm install -g mp-sentinel@1.0.1` |
| **1.0.0** | `Legacy`   | Phiên bản khởi đầu với hỗ trợ đa nhà cung cấp AI.            | `npm install -g mp-sentinel@1.0.0` |

---

## 🛠️ Xử lý lỗi khi `npm install` thất bại

Nếu bạn gặp lỗi (Timeout, 403, 500, hoặc kết nối chậm) khi cài đặt, hãy thử các cách sau:

### 1. Sử dụng Registry thay thế (cho khu vực kết nối chậm)

```bash
# Sử dụng registry của China (thông dụng khi mạng quốc tế chậm)
npm install -g mp-sentinel --registry=https://registry.npmmirror.com
```

### 2. Xóa Cache và cài đặt lại

```bash
npm cache clean --force
npm install -g mp-sentinel@latest
```

### 3. Cài đặt trực tiếp từ GitHub (Nếu npmjs.com gặp sự cố)

```bash
npm install -g https://github.com/peter-minhnn/mp-sentinel.git
```

---

## 🔄 Nâng cấp và Hạ cấp (Upgrade & Downgrade)

### Cách Nâng cấp (Upgrade)

Để cập nhật lên phiên bản mới nhất:

```bash
npm update -g mp-sentinel
# Hoặc cài đặt đè bản latest
npm install -g mp-sentinel@latest
```

### Cách Hạ cấp (Downgrade)

Nếu phiên bản mới gặp lỗi tương thích với hệ thống của bạn, bạn có thể quay lại phiên bản cũ:

```bash
# Ví dụ: Quay lại bản 1.0.1
npm install -g mp-sentinel@1.0.1
```

---

## 📥 Tải xuống thủ công (Manual Download)

Nếu không thể sử dụng `npm`, bạn có thể tải mã nguồn từ [GitHub Releases](https://github.com/peter-minhnn/mp-sentinel/releases) và chạy trực tiếp:

1. Tải file `.zip` hoặc `.tar.gz` của phiên bản mong muốn.
2. Giải nén và di chuyển vào thư mục dự án.
3. Chạy lệnh:

```bash
npm install
npm run build
npm link
```
