// 种子5：排序比较器副作用模式 —— comparator 内收缩数组制造越界访问窗口
// 对应历史漏洞特征：Array.prototype.sort 比较器副作用绕过边界检查消除
// （CVE-2019-5782 / CVE-2021-38003 类 comparator side-effect 缺陷）
var arr = [1.1, 2.2, 3.3, 4.4, 5.5, 6.6];
function cmp(a, b) {
    arr.length = 1;          // 副作用：排序过程中收缩数组
    return a - b;
}
for (var i = 0; i < 30000; i++) {
    arr = [1.1, 2.2, 3.3, 4.4, 5.5, 6.6];
    arr.sort(cmp);
}
console.log(arr.length);
