const getFormData = elements => [].reduce.call(
  elements,
  (data, element) => {
    data[element.name] = element.value;
    if (element.name === 'ignore') {
      data[element.name] = data[element.name].replace(/, /, ',');
    }
    return data;
  },
  {}
);

const postForm = data => {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/playlist', true);
    request.setRequestHeader('Content-Type', 'application/json');

    request.onload = function() {
      if (this.status >= 200 && this.status < 300) {
        resolve(request.response);
      } else {
        reject({
          status: this.status,
          statusText: request.statusText,
        });
      }
    };

    request.onerror = function() {
      reject({
        status: this.status,
        statusText: request.statusText,
      });
    };

    request.send(JSON.stringify(data));
  });
};

document.addEventListener('DOMContentLoaded', async () => {
  const running = document.getElementById('running').value === 'true';

  if (running) {
    setTimeout(() => document.location.reload(), 5000);
  }

  const form = document.querySelector('.playlist-form');

  form.onsubmit = async event => {
    event.preventDefault();

    const data = getFormData(form.elements);

    await postForm(data);

    document.location = 'http://localhost:88/' + data.key;
  };

  document.querySelectorAll('.remove-from-playlist').forEach(removeButton => {
    removeButton.addEventListener('click', event => {
      console.log(event);
    });
  });
});

$(document).foundation();