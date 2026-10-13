// 种子2：数组长度边界模式 —— length 突变 + 越界访问窗口
// 对应历史漏洞特征：边界检查消除（bounds check elimination）绕过
function f(arr, k) {
    return arr[k];
}
var a = [1.1, 2.2, 3.3, 4.4];
for (var i = 0; i < 30000; i++) f(a, i % 4);
a.length = 1;
var sum = 0;
for (var j = 0; j < 8; j++) sum += f(a, j);
console.log(sum);
