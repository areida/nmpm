const form = document.querySelector('.playlist-form');

const postForm = data => {
  const request = new XMLHttpRequest();
  request.open('POST', '/playlist', true);
  request.setRequestHeader('Content-Type', 'application/json');
  request.send(JSON.stringify(data));
};

form.onsubmit = event => {
  event.preventDefault();

  const data = [].reduce.call(form.elements, (data, element) => {
    data[element.name] = element.value;
    return data;
  }, {});

  postForm(data);

  document.location = 'localhost?key=' + form.elements.key.value;
};