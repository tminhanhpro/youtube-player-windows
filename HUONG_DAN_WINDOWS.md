# YOUTUBE PLAYER cho Windows

Bản Windows của Youtube Player (Electron). Giữ nguyên remote điện thoại (quét QR) của bản Android TV.

## Build file .exe trên GitHub
1. Đưa toàn bộ thư mục này lên một kho GitHub (có thể là kho riêng, hoặc để cạnh bản Android – hai workflow không đụng nhau).
2. Vào **Actions → Build EXE (Windows) → Run workflow**.
3. Xong, tải `youtube-player.exe` ở mục **Releases** (hoặc Artifacts). Bấm đúp là chạy, không cần cài.
Workflow không ghi `version.txt`, nên không gây xung đột. Số phiên bản = số lần chạy workflow.

## Lần đầu chạy
Windows sẽ hỏi cho phép **Tường lửa** → chọn **Cho phép trên mạng riêng tư**, nếu không điện thoại sẽ không kết nối được.
Điện thoại và máy tính phải cùng Wi-Fi/LAN.

## Tiến độ các giai đoạn
- [x] GĐ1: nền tảng (server, hàng đợi, tìm kiếm, remote điện thoại, build exe)
- [x] GĐ2: phát video trong cửa sổ (yt-dlp + proxy, dự phòng khung YouTube nhúng)
- [x] GĐ3: giao diện 3 cột đầy đủ (thể loại, yêu thích, karaoke, cài đặt)
- [x] GĐ4: xuất HDMI chỉ khung phát
- [x] GĐ5: hiệu ứng cổ vũ (76 loại) + tin nhắn chạy từ điện thoại

## Chạy thử khi phát triển
`npm install`, `npm run check` (kiểm tra nền), `npm start`. Cần đặt `yt-dlp.exe` và `deno.exe` vào thư mục `bin/` để lấy link video.

## Phím tắt và chuột (thay cho remote TV)
| Thao tác | Tác dụng |
|---|---|
| Click / **Enter** trên bài | Thêm vào hàng đợi (nếu chưa phát gì thì phát ngay) |
| **Shift**+click / Shift+Enter | Ưu tiên: đưa lên đầu hàng đợi |
| **Chuột phải** / giữ Enter / phím Menu | Thêm bài vào Yêu thích (trong mục Yêu thích: xoá) |
| Click bài ở hàng đợi | Phát ngay · chuột phải hoặc Delete: xoá khỏi hàng đợi |
| Chuột phải / Delete trên thể loại | Xoá thể loại (có hộp xác nhận, mặc định "GIỮ LẠI") |
| Mũi tên | Di chuyển giữa các ô |
| **F** hoặc **I** hoặc nút ⛶ | Phóng to video · bất kỳ phím/chuột nào: thu nhỏ |
| Space / phím Play-Pause | Tạm dừng / phát · Media Next: bài tiếp |
| Ctrl+←/→ | Lùi/tua 10 giây · `+`/`-`: âm lượng · `/`: ô tìm kiếm · F11: toàn màn hình cửa sổ |

Tự phóng to sau 5 giây không thao tác (đổi trong Cài đặt), 5 giây cuối đếm ngược 5→0.
Tìm bằng giọng nói: nút micro thử dùng nhận dạng giọng nói của Chromium; nếu máy không hỗ trợ sẽ báo và bạn gõ hoặc dùng điện thoại.

## Xuất ra màn hình lớn (HDMI / máy chiếu)
1. Mở app, rồi cắm HDMI. Nhấn **Win + P** và chọn **Mở rộng (Extend)**. Không chọn "Nhân đôi" (Duplicate) vì khi đó Windows chiếu nguyên màn hình laptop và app không điều khiển được.
2. App tự mở một cửa sổ toàn màn hình trên màn hình lớn, **chỉ chứa video** (không có 3 cột). Giao diện đầy đủ ở lại trên laptop.
3. Khung phát nhỏ trên laptop vẫn chạy song song (tắt tiếng, tự đồng bộ với màn lớn) và ghi "ĐANG XUẤT RA TV". Tiếng phát ra màn lớn.
4. Rút HDMI: cửa sổ TV tự đóng, bài đang phát tiếp tục trên laptop (có tiếng), không mất vị trí.
5. Cài đặt → "Xuất ra màn hình ngoài (HDMI)": TỰ ĐỘNG / TẮT.

Nếu tiếng không ra TV: vào Cài đặt âm thanh của Windows, đặt thiết bị HDMI (tên TV/Display Audio) làm thiết bị phát mặc định.
Cửa sổ TV không cướp phím của laptop; khi đang xuất ra TV, video trên laptop không tự phóng to.

## Hiệu ứng từ điện thoại
Nút "Cổ vũ" trên remote điện thoại (76 hiệu ứng: thả tim, pháo giấy, pháo hoa, rồng, cá voi...) và tin nhắn chữ chạy sẽ hiện phủ lên video.
Khi đang xuất ra màn hình lớn thì hiệu ứng chạy trên màn lớn (không chạy trùng ở laptop).
Ghi chú: bản Android không có dòng chữ "Tiếp theo" chạy trên màn hình nên bản Windows cũng không có.

## Chẩn đoán lỗi phát video
Mỗi lần lấy link video, app ghi nhật ký vào `%APPDATA%\youtube-player-windows\youtube-player.log` (OK/FAIL, thời gian, lý do). Khi báo "Không phát được bài này", lý do ngắn cũng hiện ngay dưới dòng báo lỗi trong khung phát.

## Micro (tìm bằng giọng nói) trên máy tính
Electron không có dịch vụ nhận giọng nói của Google, nên nút micro mở **Nhập bằng giọng nói của Windows (Win+H)** vào ô tìm kiếm: nói xong bấm Enter. Cần Windows 10/11, bật "Nhận dạng giọng nói trực tuyến" và có micro. Trên điện thoại: dùng phím micro của bàn phím.

## Báo cáo lỗi trong app
**Cài đặt → "Báo cáo lỗi / nhật ký phát video"**: phần TỔNG HỢP ở đầu (phiên bản, yt-dlp/deno có hay thiếu, số lần lấy link OK/lỗi, thời gian trung bình, lỗi hay gặp) rồi tới 60 dòng nhật ký gần nhất. Nút **Sao chép** để gửi lại cho người hỗ trợ, **Mở thư mục** mở file `youtube-player.log`, **Xóa nhật ký** để bắt đầu đo lại.

## Lỗi 403 khi tải luồng video
googlevideo có thể từ chối (HTTP 403) tùy cách yêu cầu hoặc tùy "client" YouTube mà yt-dlp dùng. Proxy thử lần lượt: tải theo kiểu yt-dlp (`&range=`) rồi tới Range header; nếu vẫn 403 thì app đổi client YouTube (android_vr, tv) và nhớ client nào phát được. Dòng nhật ký `PROXY dùng cách ...`, `ĐỔI client ...`, `Nhớ biến thể ...` cho biết app đã chọn gì.

## Nếu vẫn bị 403: kiểm tra IP mạng
Link YouTube gắn với IP công cộng lúc lấy link. Nếu mạng có nhiều đường ra (cân bằng tải, CGNAT, VPN...), mỗi kết nối mới có thể ra bằng IP khác và bị từ chối. App giữ một kết nối bền cho mỗi luồng và tự mở kết nối mới khi bị 403. **Cài đặt → Báo cáo lỗi → Kiểm tra IP mạng** mở 8 kết nối mới và cho biết IP có đổi không.
