// 国际化支持
function i18n(messageName) {
  return chrome.i18n.getMessage(messageName) || messageName;
}

// 初始化页面文本
function initializeI18n() {
  // 更新所有带有 data-i18n 属性的元素
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const messageName = element.getAttribute('data-i18n');
    element.textContent = i18n(messageName);
  });

  // 更新所有带有 data-i18n-placeholder 属性的元素
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const messageName = element.getAttribute('data-i18n-placeholder');
    element.placeholder = i18n(messageName);
  });
}

document.addEventListener('DOMContentLoaded', function() {
  // 初始化国际化
  initializeI18n();

  const downloadBtn = document.getElementById('downloadBtn');
  const status = document.getElementById('status');
  const progress = document.getElementById('progress');
  const serverUrl = document.getElementById('serverUrl');
  const serverHint = document.getElementById('serverHint');
  const historyDropdown = document.getElementById('historyDropdown');
  const historyList = document.getElementById('historyList');
  const directoryDialog = document.getElementById('directoryDialog');
  const directoryList = document.getElementById('directoryList');
  const dialogCancel = document.getElementById('dialogCancel');
  const dialogConfirm = document.getElementById('dialogConfirm');

  let currentDirectories = [];
  let selectedPath = '';
  let pdfBlob = null;
  let pdfFileName = '';
  let pathHistory = [{ name: '根目录', uri: '' }];

  // 显示服务器地址提示
  serverHint.classList.add('show');

  // 加载历史地址
  async function loadServerHistory() {
    const result = await chrome.storage.local.get(['serverUrls']);
    const serverUrls = result.serverUrls || [];
    
    if (serverUrls.length === 1) {
      // 如果只有一个历史地址，直接显示
      serverUrl.value = serverUrls[0];
      serverHint.classList.remove('show');
    } else if (serverUrls.length > 1) {
      // 如果有多个历史地址，显示下拉按钮
      historyDropdown.classList.add('show');
      // 更新历史列表
      historyList.innerHTML = serverUrls.map(url => 
        `<div class="history-item">${url}</div>`
      ).join('');
    } else {
      // 没有历史地址，显示提示
      serverHint.classList.add('show');
    }
  }

  // 保存服务器地址到历史记录
  async function saveServerToHistory(url) {
    const result = await chrome.storage.local.get(['serverUrls']);
    let serverUrls = result.serverUrls || [];
    
    // 如果地址已存在，移到最前面
    serverUrls = serverUrls.filter(u => u !== url);
    serverUrls.unshift(url);
    
    // 最多保存5个历史记录
    serverUrls = serverUrls.slice(0, 5);
    
    await chrome.storage.local.set({ serverUrls });
    loadServerHistory();
  }

  // 历史地址下拉按钮点击事件
  historyDropdown.addEventListener('click', function(e) {
    e.stopPropagation();
    historyList.classList.toggle('show');
  });

  // 选择历史地址
  historyList.addEventListener('click', function(e) {
    if (e.target.classList.contains('history-item')) {
      serverUrl.value = e.target.textContent;
      historyList.classList.remove('show');
      serverHint.classList.remove('show');
    }
  });

  // 点击其他地方关闭历史列表
  document.addEventListener('click', function() {
    historyList.classList.remove('show');
  });

  // 当用户开始输入地址时隐藏提示
  serverUrl.addEventListener('input', function() {
    serverHint.classList.remove('show');
  });

  // 解析网页内容中的JSON数据
  function parseDirectoryJson(content) {
    const match = content.match(/const json = '(.+?)'/);
    if (!match) {
      throw new Error(i18n('errorParseDirectory'));
    }
    return JSON.parse(match[1]);
  }

  // 获取目录列表
  async function getDirectories(path = '') {
    const url = serverUrl.value.trim() + path;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(i18n('errorGetDirectory').replace('$1', `${response.status} ${response.statusText}`));
    }
    const content = await response.text();
    const data = parseDirectoryJson(content);
    return data.fileList.filter(item => item.isDirectory);
  }

  // 更新面包屑导航
  function updateBreadcrumb() {
    const breadcrumb = document.getElementById('pathBreadcrumb');
    breadcrumb.innerHTML = pathHistory
      .map((path, index) => `
        <span data-index="${index}" style="cursor: pointer;">
          ${path.name}
        </span>
      `)
      .join('');
    
    // 添加面包屑点击事件
    breadcrumb.querySelectorAll('span').forEach(span => {
      span.addEventListener('click', () => {
        const index = parseInt(span.dataset.index);
        navigateToPath(index);
      });
    });
  }

  // 导航到指定路径
  async function navigateToPath(index) {
    pathHistory = pathHistory.slice(0, index + 1);
    const path = pathHistory[index].uri;
    const directories = await getDirectories(path);
    showDirectoryDialog(directories);
  }

  // 修改显示目录选择对话框函数
  function showDirectoryDialog(directories) {
    currentDirectories = directories;
    directoryList.innerHTML = '';
    
    directories.forEach((dir, index) => {
      const item = document.createElement('div');
      item.className = 'directory-item';
      if (dir.uri === selectedPath) {
        item.classList.add('selected');
      }
      item.innerHTML = `
        <span class="icon">📁</span>
        <span>${dir.name}</span>
      `;
      item.dataset.index = index;
      item.onclick = () => selectDirectory(index);
      directoryList.appendChild(item);
    });

    updateBreadcrumb();
    directoryDialog.style.display = 'block';
  }

  // 修改选择目录函数
  async function selectDirectory(index) {
    const directory = currentDirectories[index];
    try {
      // 更新选中状态
      directoryList.querySelectorAll('.directory-item').forEach(item => {
        item.classList.remove('selected');
      });
      directoryList.children[index].classList.add('selected');

      const subdirectories = await getDirectories(directory.uri);
      if (subdirectories.length > 0) {
        pathHistory.push({ name: directory.name, uri: directory.uri });
        showDirectoryDialog(subdirectories);
      }
      selectedPath = directory.uri;
    } catch (error) {
      status.textContent = i18n('errorPrefix') + error.message;
    }
  }

  // 上传到Supernote的函数
  async function uploadToSupernote(blob, fileName, path) {
    const url = serverUrl.value.trim();
    if (!url) {
      throw new Error(i18n('errorNoServer'));
    }

    const formData = new FormData();
    formData.append('file', blob, fileName);

    const response = await fetch(`${url}${path}`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(i18n('errorUploadFailed').replace('$1', `${response.status} ${response.statusText}`));
    }

    // 保存当前使用的地址
    await chrome.storage.local.set({ currentServer: url });

    return await response.json();
  }

  // 保存为PDF并准备上传
  async function saveToPDF(tab) {
    status.textContent = i18n('statusGeneratingPdf');
    progress.value = 25;

    try {
      const url = serverUrl.value.trim();
      if (!url) {
        throw new Error(i18n('errorNoServer'));
      }

      // 连接debugger
      await chrome.debugger.attach({ tabId: tab.id }, '1.3');

      // 等待页面加载完成并准备页面
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          return new Promise((resolve) => {
            window.scrollTo(0, 0);
            setTimeout(resolve, 500);
          });
        }
      });

      // 获取页面宽度并计算合适的缩放比例
      const scaleResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          return Math.max(
            document.documentElement.scrollWidth,
            document.documentElement.offsetWidth,
            document.documentElement.clientWidth
          );
        }
      });

      const pageWidth = scaleResult[0].result;
      const targetWidth = 793;
      const scale = Math.min(1, targetWidth / pageWidth);
      
      // 设置打印参数
      const printParams = {
        landscape: false,
        displayHeaderFooter: false,
        printBackground: true,
        scale: scale,
        paperWidth: 8.27,
        paperHeight: 11.69,
        marginTop: 0.4,
        marginBottom: 0.4,
        marginLeft: 0.4,
        marginRight: 0.4,
        pageRanges: '',
        preferCSSPageSize: false
      };

      status.textContent = i18n('statusGeneratingPdf');
      progress.value = 50;
      
      // 执行打印命令
      const result = await chrome.debugger.sendCommand(
        { tabId: tab.id },
        'Page.printToPDF',
        printParams
      );

      if (!result || !result.data) {
        throw new Error(i18n('errorPdfGeneration'));
      }

      // 生成文件名
      pdfFileName = `${tab.title || 'webpage'}_${new Date().toISOString().slice(0,19).replace(/[:.]/g, '-')}.pdf`;

      // 将base64数据转换为blob
      const binaryData = atob(result.data);
      const bytes = new Uint8Array(binaryData.length);
      for (let i = 0; i < binaryData.length; i++) {
        bytes[i] = binaryData.charCodeAt(i);
      }
      pdfBlob = new Blob([bytes], { type: 'application/pdf' });

      // 断开debugger连接
      await chrome.debugger.detach({ tabId: tab.id });

      // 获取并显示根目录
      const directories = await getDirectories();
      showDirectoryDialog(directories);

    } catch (error) {
      // 确保断开debugger连接
      try {
        await chrome.debugger.detach({ tabId: tab.id });
      } catch (e) {
        // 忽略断开连接时的错误
      }
      throw new Error(i18n('errorProcessing').replace('$1', error.message));
    }
  }

  // 修改对话框取消按钮事件
  dialogCancel.onclick = () => {
    directoryDialog.style.display = 'none';
    status.textContent = i18n('statusCanceled');
    progress.style.display = 'none';
    // 重置路径历史
    pathHistory = [{ name: i18n('rootDirectory'), uri: '' }];
    selectedPath = '';
  };

  dialogConfirm.onclick = async () => {
    if (!selectedPath) {
      status.textContent = i18n('errorNoLocation');
      return;
    }

    directoryDialog.style.display = 'none';
    status.textContent = i18n('statusUploading');
    progress.value = 75;

    try {
      await uploadToSupernote(pdfBlob, pdfFileName, selectedPath);
      progress.value = 100;
      status.textContent = i18n('statusSuccess');
      await saveServerToHistory(serverUrl.value.trim());
    } catch (error) {
      status.textContent = i18n('errorPrefix') + error.message;
      progress.style.display = 'none';
    }
  };

  // 点击保存按钮
  downloadBtn.addEventListener('click', async function() {
    let url = serverUrl.value.trim();
    if (!url) {
      status.textContent = i18n('errorNoServer');
      serverHint.classList.add('show');
      return;
    }

    // 自动补全地址格式
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'http://' + url;
    }
    if (!url.includes(':8089')) {
      url += ':8089';
    }
    serverUrl.value = url; // 更新输入框中的地址

    try {
      // 验证URL格式
      new URL(url);
    } catch (error) {
      status.textContent = i18n('errorInvalidUrl');
      return;
    }

    progress.style.display = 'block';
    progress.value = 10;

    try {
      const tabs = await chrome.tabs.query({active: true, currentWindow: true});
      
      if (!tabs || !tabs[0]) {
        throw new Error(i18n('errorNoTab'));
      }

      const currentTab = tabs[0];
      
      if (!currentTab.url || currentTab.url.startsWith('chrome://')) {
        throw new Error(i18n('errorInvalidPage'));
      }

      await saveToPDF(currentTab);
    } catch (error) {
      status.textContent = i18n('errorPrefix') + (error.message || i18n('errorUnknown'));
      progress.style.display = 'none';
    }
  });

  // 初始化加载历史地址
  loadServerHistory();
}); 