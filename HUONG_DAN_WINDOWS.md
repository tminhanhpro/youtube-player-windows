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
- [x] GĐ6: chữ chào mừng gõ trên máy tính (mẫu lưu sẵn, màu, cỡ, vị trí, tự ẩn)
- [x] GĐ7: phát nhạc / video có sẵn trong máy (thư viện thư mục, kéo thả, không cần mạng và không cần yt-dlp)
- [x] GĐ8: bảng hiệu ứng âm thanh riêng — đã xong: lưu trữ (bước 1), phát trên TV/máy tính (bước 2), cửa sổ quản lý trên máy tính (bước 3), bảng nút trên điện thoại (bước 4), phím tắt 1–9 + tự hạ nhạc (bước 5)
- [x] GĐ9: Kịch bản (bộ bài) cho từng buổi tiệc — lưu trữ, chạy lá bài, cửa sổ quản lý, thêm từ nguồn có sẵn, chế độ dùng khi diễn ra buổi tiệc, điện thoại remote, hoàn thiện
- [x] GĐ10: Tải Sẵn Về Máy — quét thư mục, hàng đợi tải yt-dlp, phát từ file có dự phòng trực tuyến, hộp thoại tiến độ, nhãn "Đã tải", tài liệu

## Chạy thử khi phát triển
`npm install`, `npm run check` (kiểm tra nền, gồm cả test bộ bài và tải sẵn), `npm start`. Test giao diện (cần Playwright): `npm run check:ui`. Cần đặt `yt-dlp.exe` và `deno.exe` vào thư mục `bin/` để lấy link video.

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
| **M** (giữ) / nút "MC nói" | Nhạc nhỏ lại khi MC nói, thả ra nhạc trở lại · bấm nhanh phím M (dưới 0,35 giây) = bật/tắt |
| **O** / nút "Fade out" | Nhạc nhỏ dần rồi dừng · bấm lại giữa chừng để huỷ · bấm Phát thì nhạc vào lại từ từ |
| **W** / nút "Chữ Chào Mừng" | Đang hiện chữ thì ẩn · chưa hiện thì hiện lại chữ gần nhất (chưa có thì mở hộp soạn chữ) |
| Ctrl+←/→ | Lùi/tua 10 giây · `+`/`-`: âm lượng · `/`: ô tìm kiếm · F11: toàn màn hình cửa sổ |

Tự phóng to sau 5 giây không thao tác (đổi trong Cài đặt), 5 giây cuối đếm ngược 5→0.
Tìm bằng giọng nói: nút micro thử dùng nhận dạng giọng nói của Chromium; nếu máy không hỗ trợ sẽ báo và bạn gõ hoặc dùng điện thoại.

## Chữ chào mừng (đám cưới, sinh nhật, thôi nôi...)
Bấm nút **Chữ Chào Mừng** ở cột trái (hoặc phím **W**) để mở hộp soạn chữ:
1. Gõ chữ vào ô (tối đa 3 dòng, Enter xuống dòng). Khung xem trước phía trên cho thấy chữ sẽ trông thế nào.
2. Chọn **màu**, **cỡ chữ** (5 mức, tự thu nhỏ nếu chữ dài), **vị trí** (giữa/trên/dưới) và **tự ẩn sau** (giữ đến khi ẩn, hoặc 10 giây đến 2 phút).
3. Bấm **HIỆN LÊN MÀN HÌNH** (hoặc Ctrl+Enter): chữ hiện trên cửa sổ TV/HDMI và cả khung phát trên laptop. Bấm **ẨN CHỮ** hoặc phím **W** để tắt.
4. **LƯU MẪU** để dùng lại (tối đa 30 mẫu, có sẵn vài mẫu). Bấm một mẫu ở cột trái để nạp vào ô soạn; **XOÁ MẪU** bấm hai lần để xác nhận.
Chữ vẫn hiện nếu cắm HDMI giữa chừng, và không làm mất tiếng hay video đang phát.

## Nhạc & video có sẵn trong máy (không cần mạng)
Bấm nút **Nhạc Trong Máy** ở cột trái:
1. **+ Thêm thư mục…** chọn nơi chứa nhạc (app quét cả thư mục con, tối đa 5000 bài, quét lại mỗi lần mở hộp) hoặc **+ Thêm file…** chọn từng file. Thư viện được nhớ cho lần sau.
2. Gõ vào ô lọc để tìm theo tên bài hoặc tên thư mục (gõ không dấu vẫn tìm được).
3. Mỗi bài có **▶ Phát ngay** và **+ Hàng đợi**; nút **THÊM TẤT CẢ VÀO HÀNG ĐỢI** thêm tối đa 200 bài (đúng thứ tự tên file, nên đặt tên 01, 02, 03... để chạy theo kịch bản).
4. **Kéo thả** file hoặc thư mục vào cửa sổ app ở bất kỳ lúc nào: app nhớ vào thư viện và cho vào hàng đợi (nếu đang rảnh thì bài đầu phát ngay).
Bài trong máy nằm chung hàng đợi với bài YouTube, dùng chung nút MC hạ nhạc, fade vào/ra, tua, âm lượng và xuất HDMI. Nhạc không có hình (mp3...) hiện nền nốt nhạc kèm tên bài. Điện thoại vẫn thấy hàng đợi nhưng không duyệt được thư viện này.

**Phát ngay một video / bài nhạc:** trong cửa sổ **Nhạc Trong Máy**, bấm **▶ Chọn & phát ngay…**, chọn file là phát liền (không cần thêm vào thư viện). Với file đã có trong thư viện thì bấm **▶ Phát ngay** ở dòng đó. Kéo thả file vào cửa sổ cũng phát ngay nếu đang rảnh. Video (mp4, mkv...) phát bằng chính hình của nó.

**Hình nền / video nền khi phát nhạc không có hình (mp3...):** ở thanh **Nền khi phát nhạc** trong cùng cửa sổ, bấm **🖼 Chọn hình…** (jpg, png, webp, gif, bmp) hoặc **🎞 Chọn video…** (mp4, webm, mkv, mov, m4v). Video nền tắt tiếng và lặp lại. Dòng video trong thư viện có nút **Làm nền** để dùng luôn. Nền hiện trên cả cửa sổ máy tính và màn hình lớn, đổi được ngay khi đang phát; **Bỏ nền** để về nền tím có nốt nhạc. Nền chỉ dùng cho nhạc không có hình, không ảnh hưởng video và bài YouTube. Nên dùng file nền dưới vài chục MB cho nhẹ máy.
Định dạng phát được: mp3, m4a, aac, wav, flac, ogg, opus · mp4, m4v, mov, webm, mkv. **Không phát được** wma, avi, wmv, flv (hãy đổi sang mp3 hoặc mp4). Video mkv/mov dùng codec lạ (HEVC, AC3, DTS) có thể báo lỗi và app tự chuyển bài kế. Nếu file bị xoá hoặc rút ổ đĩa, app báo lỗi rồi chuyển bài.

## Tải sẵn về máy (phát không cần mạng)
Bấm nút **Tải Sẵn Về Máy** ở cột trái. Dùng khi hội trường không có Wi-Fi hoặc mạng yếu: tải trước ở nhà, đến nơi phát từ file.
1. Chọn phạm vi: **Yêu thích**, **Hàng đợi** hoặc từng **Bộ bài** (mỗi dòng ghi "đã tải x/y"). Bấm **Tải phần còn thiếu** / **Tải về**: app chỉ tải bài chưa có, tải lần lượt từng bài, hiện phần trăm, tốc độ, thời gian còn lại. Bài lỗi tự thử lại một lần bằng cách khác; còn lỗi thì hiện lý do và có nút xoá dòng.
2. **Kiểu tải**: *Hình + tiếng* (video) hoặc *Chỉ tiếng* (m4a, nhẹ, hợp khi chỉ cần nhạc). Bấm nút trên từng dòng để huỷ bài đó hoặc xoá dòng lỗi, hay dùng **Huỷ tất cả**, **Xoá dòng đã xong** để dọn danh sách.
3. **Thư mục lưu**: mặc định `Nhạc\Youtube Player` (thư mục Music của Windows). Bấm **Đổi thư mục…** để đổi, **Mặc định** để quay lại, **Quét lại** nếu bạn tự chép/xoá file, **Mở thư mục** để xem file.
4. Bài đã tải có nhãn **⬇ Đã tải** trên thẻ bài, Yêu thích, hàng đợi và trên điện thoại. Khi phát, app tự dùng file trong máy; nếu file mất, hỏng hoặc đứng hình thì chuyển sang phát trực tuyến tiếp từ chỗ đang nghe (cần có mạng).
5. Tên file dạng `Tên bài [mã video].mp4`. **Đừng xoá hay sửa phần `[mã video]`**, vì app dựa vào mã này để biết bài nào đã tải. Đổi phần tên trước dấu `[` thì không sao.
6. Trong lúc hộp tải đang mở, phím tắt tạm tắt và kéo thả file nhạc bị chặn (app có báo); đóng hộp rồi hãy thả file.

**Về ffmpeg (chất lượng hình):** yt-dlp cần ffmpeg để ghép hình và tiếng của video chất lượng cao. Nếu không có ffmpeg, app chỉ tải bản gộp sẵn của YouTube, thường chỉ **360p**, và hộp thoại hiện lời nhắc màu vàng. Chế độ *Chỉ tiếng* không bị ảnh hưởng. Có hai cách có ffmpeg:
- **Đóng gói sẵn trong .exe**: khi bấm *Run workflow* trên GitHub, tích ô **bundle_ffmpeg**. File .exe nặng thêm khoảng 100 MB. Mặc định không tích.
- **Tự thêm**: đặt `ffmpeg.exe` vào thư mục `bin` cạnh `yt-dlp.exe` (hoặc cài ffmpeg vào PATH của Windows).

## Hiệu ứng âm thanh riêng (vỗ tay, reo hò, lời mời cô dâu chú rể...)
Bấm nút **Hiệu Ứng Riêng** ở cột trái để mở bảng quản lý (tối đa 40 nút):
1. **+ Thêm file…** chọn một hoặc nhiều file âm thanh, hoặc **kéo thả** file vào cửa sổ khi bảng đang mở (lúc này file thả vào thành hiệu ứng, không vào hàng đợi nhạc). Chỉ nhận file âm thanh (mp3, m4a, wav, flac, ogg, opus, aac); video, thư mục và file đã có sẵn trong bảng sẽ bị bỏ qua và app báo số file bị bỏ.
2. Mỗi hiệu ứng có: tên (gõ rồi Enter, tối đa 24 ký tự), biểu tượng (bấm vào ô emoji để chọn hoặc gõ emoji riêng), **thanh âm lượng riêng** (thả ra là tự nghe thử ở mức đó), **▶ nghe thử**, đổi chỗ bằng **▲ ▼** hoặc kéo **≡**, và **✕ xoá** (bấm hai lần liên tiếp mới xoá; chỉ xoá nút, không xoá file trên máy).
3. **■ Dừng hết** dừng mọi hiệu ứng đang phát, trên cả TV và máy tính.
4. Nghe thử luôn phát trên máy tính này, kể cả khi đang xuất ra TV. File bị xoá hoặc di chuyển sẽ hiện tên màu đỏ và không nghe thử được.
5. **Trên điện thoại remote:** bấm nút **Bộ sưu tập** (mặt cười), khung **Âm thanh của bạn** hiện phía trên các hiệu ứng cổ vũ. Bấm nút nào là phát trên TV (hoặc trên máy tính nếu không xuất TV), nút đỏ **■ Dừng hết** dừng mọi hiệu ứng. Chưa thêm hiệu ứng nào thì khung này ẩn. Mỗi lần mở Bộ sưu tập, điện thoại tự lấy lại danh sách mới nhất từ máy tính; file bị xoá thì nút mờ đi, bấm vào sẽ báo. Điện thoại chỉ thấy tên, biểu tượng và bấm phát, không xem được đường dẫn file. Tối đa 10 hiệu ứng mỗi giây từ tất cả điện thoại cộng lại, bấm dồn quá mức thì bị bỏ bớt.
6. **Phím tắt 1–9 trên máy tính:** bấm số **1** phát hiệu ứng đầu tiên trong bảng, **2** là hiệu ứng thứ hai... đến **9** (số thứ tự hiện cạnh mỗi hàng trong bảng quản lý, đổi chỗ hàng là đổi phím). Phím này chạy cả khi đang phóng lớn video và không làm thoát phóng lớn; tên hiệu ứng hiện ở giữa dưới màn hình cho MC biết đã bấm trúng. Giữ phím không phát lặp. Không chạy khi đang gõ ô tìm kiếm, khi đang mở một hộp thoại, hoặc khi giữ Shift/Ctrl/Alt. Phím tắt này là của cửa sổ máy tính; điện thoại dùng nút bấm.
7. **Tự hạ nhạc khi hiệu ứng phát:** bấm nút **Tự hạ nhạc khi hiệu ứng phát** ở đầu bảng (hoặc trong **Cài đặt**). Khi bật, nhạc nền nhỏ lại ngay lúc hiệu ứng bắt đầu và trở lại từ từ khi hiệu ứng cuối cùng hết (hoặc bấm Dừng hết). Mức hạ dùng chung với nút MC (**Nhạc hạ còn khi MC nói**, chỉnh trong Cài đặt). Mặc định **TẮT**. Áp dụng cho cả hiệu ứng bấm từ điện thoại. Nút MC vẫn riêng: MC đang giữ thì hiệu ứng hết nhạc vẫn nhỏ. Nếu cửa sổ TV bị đóng đột ngột lúc hiệu ứng đang chạy, nhạc tự trở lại sau tối đa 3 phút. Nghe thử (▶) không hạ nhạc.

## Kịch bản (bộ bài cho từng buổi tiệc)
**Bộ bài** là một buổi tiệc (ví dụ "Đám cưới 20/12", tối đa 30 bộ). **Lá bài** là một việc cần làm trong buổi đó (ví dụ "Cắt bánh", tối đa 60 lá mỗi bộ). Mỗi lá thuộc một trong 4 loại: **hiệu ứng riêng**, **nhạc/video trong máy**, **bài YouTube**, **chữ chào mừng**; hoặc là **ô trống** (có tên nhưng chưa gán nội dung).
1. **Soạn bộ bài:** bấm nút **Kịch Bản** ở cột trái (dưới Hiệu Ứng Riêng). Bên trái là danh sách bộ bài, bên phải là các lá bài. Tạo bộ mới, hoặc tạo từ **mẫu dựng sẵn** (Đám cưới, Sinh nhật, Thôi nôi: các ô Đón khách → Cắt bánh → Mời rượu... chỉ việc gán nhạc). Đổi tên, đổi biểu tượng, **nhân bản** cả bộ, đổi chỗ bằng kéo **≡**, và **✕ xoá** (bấm hai lần liên tiếp mới xoá).
2. **Thêm lá bài:** chọn từ bảng hiệu ứng, thư viện nhạc trong máy, bài Yêu thích hoặc mẫu chữ chào mừng. Nút **Lưu hàng đợi hiện tại thành bộ bài** rất tiện khi bạn đã xếp nhạc xong. Ô trống thì bấm **Gán nội dung…** để gán sau. Nhạc có hai kiểu: **phát ngay** hoặc **vào hàng đợi**.
3. **Nạp cả bộ vào hàng đợi:** bấm **Nạp cả bộ vào hàng đợi** (cạnh **+ Thêm lá bài…**) để lấy các lá nhạc trong máy và YouTube theo đúng thứ tự lá bài; hiệu ứng, chữ và ô trống được bỏ qua; bài trùng hoặc đã có trong hàng đợi chỉ thêm một lần. App báo kết quả ở dòng trạng thái (đã nạp mấy bài, mấy bài thiếu file, hàng đợi đầy...).
4. **Chế độ dùng khi buổi tiệc diễn ra:** bấm **▶ Dùng bộ này**, các lá hiện thành lưới nút lớn. Bấm một lá để chạy lá đó (bấm lại sẽ chạy lại). Phím **Space** hoặc **Enter** chạy lá kế tiếp, giống clicker của MC: lá chưa chạy và dùng được, bỏ qua ô trống và lá bị mất file. Lá đã chạy được đánh dấu, nút **Đặt lại** xoá dấu để chạy lại từ đầu. Dấu "đã chạy" của mỗi bộ được giữ riêng và nhớ cả khi tắt mở app giữa buổi. Phím 1–9 vẫn dành cho hiệu ứng riêng, nên lá bài chỉ dùng Space/Enter và chuột.
5. **Trên điện thoại remote:** hàng nút phụ có nút **Kịch bản**. Bấm vào sẽ mở bộ đang dùng trên máy tính (chỉ có một bộ thì mở luôn; không thì chọn trong danh sách). Có nút lớn **▶ Kế tiếp: tên lá** và lưới các lá bài: lá kế tiếp có viền vàng, lá đã chạy mờ kèm dấu ✓, ô trống và lá mất file bị mờ. Dấu "đã chạy" đồng bộ hai chiều với máy tính (điện thoại tự cập nhật mỗi 3 giây). **Đặt lại** phải bấm hai lần trong 3 giây. Điện thoại chỉ thấy tên, biểu tượng, loại và trạng thái của lá, không xem được đường dẫn file hay nội dung chữ. Tối đa 5 lần chạy mỗi giây từ tất cả điện thoại cộng lại; riêng **Kế tiếp** cách nhau ít nhất 0,5 giây để bấm đúp không nhảy cóc một lá.
6. **Khi có sự cố:** lá bị mất file (xoá file, rút ổ đĩa) hoặc trỏ tới hiệu ứng đã bị xoá sẽ ghi **Bị mất** (đỏ trong chế độ dùng) và báo khi bấm, không đánh dấu đã chạy; cắm lại ổ đĩa thì lá dùng được trở lại. Hàng đợi đầy thì lá nhạc không chạy và không bị đánh dấu, hết đầy bấm lại được. Xoá một hiệu ứng ở bảng Hiệu Ứng Riêng không xoá lá bài đang dùng nó, lá chỉ báo mất.
7. **Lưu ý:** bộ bài lưu đường dẫn tuyệt đối tới file nhạc (giống thư viện nhạc trong máy). Chép app sang máy khác thì các lá nhạc sẽ báo mất file; chưa có tính năng xuất/nhập bộ bài.

## Xuất ra màn hình lớn (HDMI / máy chiếu)
1. Mở app, rồi cắm HDMI. Nhấn **Win + P** và chọn **Mở rộng (Extend)**. Không chọn "Nhân đôi" (Duplicate) vì khi đó Windows chiếu nguyên màn hình laptop và app không điều khiển được.
2. App tự mở một cửa sổ toàn màn hình trên màn hình lớn, **chỉ chứa video** (không có 3 cột). Giao diện đầy đủ ở lại trên laptop.
3. Khung phát nhỏ trên laptop vẫn chạy song song (tắt tiếng, tự đồng bộ với màn lớn) và ghi "ĐANG XUẤT RA TV". Tiếng phát ra màn lớn.
4. Rút HDMI: cửa sổ TV tự đóng, bài đang phát tiếp tục trên laptop (có tiếng), không mất vị trí.
5. Cài đặt → "Xuất ra màn hình ngoài (HDMI)": TỰ ĐỘNG / TẮT.

Nếu tiếng không ra TV: vào Cài đặt âm thanh của Windows, đặt thiết bị HDMI (tên TV/Display Audio) làm thiết bị phát mặc định.
Cửa sổ TV không cướp phím của laptop; khi đang xuất ra TV, video trên laptop không tự phóng to.

## MC nói (tự hạ nhạc) và Fade vào/ra
- **MC nói**: nhạc hạ nhanh (0,3 giây) xuống mức đã chọn (mặc định 20%), thả ra thì nhạc lên lại từ từ (0,8 giây). Dùng được trên máy tính (phím **M** hoặc nút) và trên điện thoại (nút "MC nói" ở dưới cùng, **giữ** để nói, **bấm nhanh** để bật/tắt, nút sáng màu vàng khi đang hạ nhạc).
- Nếu quên nhả nút giữ (điện thoại hết pin, mất Wi-Fi...), sau 45 giây app tự trả nhạc lại. Khi MC nói lâu hơn thì điện thoại/máy tính tự gửi tín hiệu "vẫn đang giữ" nên không bị ngắt giữa chừng.
- Đang hạ nhạc mà chuyển bài thì bài mới cũng vào ở mức đã hạ.
- **Nhạc vào dần**: đầu mỗi bài âm lượng nhích từ 0 lên (mặc định 2 giây; chỉnh 0–5 giây hoặc tắt).
- **Fade out** ("Tắt dần" trên điện thoại): nhạc nhỏ dần trong 4 giây (chỉnh 2–10 giây) rồi tạm dừng. Bấm lại trong lúc đang tắt dần để huỷ. Bấm Phát thì bài vào lại từ im lặng.
- Chỉnh ở **Cài đặt** trên máy tính: "Nhạc hạ còn khi MC nói", "Nhạc vào dần đầu mỗi bài", "Thời gian fade out khi bấm nút".
- Âm lượng chính (nút +/-) và mức hạ nhạc nhân với nhau: âm lượng 50% khi MC nói ở mức 20% thì ra 10%.
- Kiểm thử: `node scripts/check.js` (logic) · `node scripts/mc-player-test.js` và `node scripts/mc-ui-test.js` (cần Playwright, kiểm tra âm lượng thật trong Chromium và giao diện).

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

## Chọn máy chủ googlevideo
Tên miền googlevideo có thể trả về nhiều máy chủ; có máy chủ (ví dụ cache của nhà mạng) từ chối link (403). Proxy tự chọn một máy chủ cho mỗi lần thử, đánh dấu máy chủ bị từ chối để tránh trong 10 phút, và ghi `máy chủ x.x.x.x` vào nhật ký. Báo cáo lỗi tự che IP của bạn (`ip=14.183.x.x`); file log trên máy vẫn giữ nguyên.

## Link mới cấp bị 403 trong khoảng 1 giây đầu
Nhật ký cho thấy 403 hay xảy ra khi video bắt đầu tải ngay sau khi lấy link (dưới ~1 giây). Proxy giờ thử lại mỗi 0,25 giây (tối đa 7 giây), cứ 3 vòng thì đổi kết nối/máy chủ. Dòng `PROXY dùng cách ... sau N lần thử lại (link cấp X ms trước)` cho biết mất bao lâu.

Các test giao diện (cần Playwright, không nằm trong `npm run check`): `node scripts/deck-ui-test.js`, `deck-live-ui-test.js`, `decks-remote-test.js` (điện thoại).


## Tìm kiếm YouTube: kết quả và cuộn tải thêm
- Kết quả giống YouTube: có cả MV, tuyển tập và video "playlist" dài cả giờ. Chỉ bỏ Shorts (video dọc, từ 60 giây trở xuống).
- Muốn bớt tuyển tập (tuỳ chọn, mặc định TẮT): mở file `settings.json` trong thư mục dữ liệu app (`%APPDATA%\\youtube-player-windows`), thêm `"searchMaxMin": 10` để chỉ giữ video tối đa 10 phút (số phút tuỳ ý, `0` = không giới hạn) và/hoặc `"searchStrict": true` để bỏ video có tiêu đề kiểu tuyển tập (playlist, tuyển tập, nonstop, top 10, 1 giờ, mix...), rồi mở lại app.
- Mỗi lần cuộn gần cuối, app gom thêm ít nhất khoảng 12 bài (tối đa 4 lô của YouTube). Tối đa 300 bài cho mỗi từ khoá.
- Nếu cuộn mà không ra thêm, xem **Cài đặt → Báo cáo lỗi / nhật ký phát video**, các dòng bắt đầu bằng "TÌM KIẾM" cho biết app lấy kết quả từ nguồn nào và còn trang tiếp hay không.

## Vị trí các nút trên màn hình máy tính
- Hai nút **MC nói** (hạ nhạc) và **Fade out** nằm ở thanh trên cùng, ngay bên trái biểu tượng wifi / Online. Phím tắt **M** và **O** vẫn dùng như cũ.
- Dưới khung đang phát, hai nút cuối hàng điều khiển giờ là **giảm âm lượng** và **tăng âm lượng** (mỗi lần bấm 5%, giống phím **-** và **+**).

## Tìm kiếm cuộn không giới hạn
Kết quả tìm kiếm tự tải thêm khi cuộn gần cuối (cả điện thoại và máy tính), giống YouTube; trên điện thoại còn có nút **Tải thêm ⌄** (và **thử lại** khi rớt mạng giữa chừng). Chỉ dừng khi YouTube hết kết quả (trần an toàn 5000 bài).
